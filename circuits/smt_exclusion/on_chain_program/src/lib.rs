#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use solana_poseidon::{hashv, Endianness, Parameters};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    instruction::Instruction,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_system_interface::instruction as system_instruction;

// NOTE: This is a devnet example program ID. For production, deploy your own program
// and update this ID. You can also override via environment-specific configuration.
solana_program::declare_id!("4WvvKAwJ2hYRqaceZyyS3s51V68LbfGsXWut7gsGnqaZ");

/// Custom errors - error code shown in logs as "Custom(N)"
/// 0 = InvalidDataLength, 1 = InvalidStateAccount, etc.
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u32)]
pub enum ExclusionError {
    /// 0: Invalid instruction data length
    InvalidDataLength = 0,
    /// 1: Invalid state account discriminator
    InvalidStateAccount = 1,
    /// 2: SMT root in proof does not match stored root
    SmtRootMismatch = 2,
    /// 3: Pubkey hash in proof does not match signer
    PubkeyHashMismatch = 3,
    /// 4: Poseidon hash computation failed
    PoseidonHashFailed = 4,
    /// 5: Only admin can perform this action
    UnauthorizedAdmin = 5,
    /// 6: Invalid state account PDA
    InvalidStatePda = 6,
    /// 7: Invalid ZK verifier program
    InvalidZkVerifier = 7,
    /// 8: ZK proof verification failed
    ZkVerificationFailed = 8,
}

impl From<ExclusionError> for ProgramError {
    fn from(e: ExclusionError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

/// ZK Verifier program ID (deployed via sunspot)
/// NOTE: This is a devnet example. For production, deploy your own verifier via
/// `sunspot deploy` and update this constant with the resulting program ID.
pub const ZK_VERIFIER_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("548u4SFWZMaRWZQqdyAgm66z7VRYtNHHF2sr7JTBXbwN");

/// State account size: 8 (discriminator) + 32 (admin) + 32 (smt_root) = 72 bytes
pub const STATE_SIZE: usize = 8 + 32 + 32;

/// State account discriminator
pub const STATE_DISCRIMINATOR: [u8; 8] = [0x73, 0x6d, 0x74, 0x5f, 0x72, 0x6f, 0x6f, 0x74]; // "smt_root"

/// Instruction discriminators
pub mod instruction {
    pub const INITIALIZE: u8 = 0;
    pub const SET_SMT_ROOT: u8 = 1;
    pub const TRANSFER_SOL: u8 = 2;
}

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    match instruction_data[0] {
        instruction::INITIALIZE => process_initialize(program_id, accounts),
        instruction::SET_SMT_ROOT => {
            process_set_smt_root(program_id, accounts, &instruction_data[1..])
        }
        instruction::TRANSFER_SOL => process_transfer_sol(accounts, &instruction_data[1..]),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Initialize a user-specific state account
/// Each admin gets their own state account (PDA derived from their pubkey)
/// Accounts:
///   0. [signer, writable] Admin (payer)
///   1. [writable] State account (PDA: ["state", admin_pubkey])
///   2. [] System program
fn process_initialize(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive PDA for user-specific state account
    let (state_pda, bump) =
        Pubkey::find_program_address(&[b"state", admin.key.as_ref()], program_id);
    if state_account.key != &state_pda {
        msg!("Invalid state account PDA");
        return Err(ExclusionError::InvalidStatePda.into());
    }

    // Create state account
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(STATE_SIZE);
    let signer_seeds: &[&[u8]] = &[b"state", admin.key.as_ref(), &[bump]];

    invoke_signed(
        &system_instruction::create_account(
            admin.key,
            state_account.key,
            lamports,
            STATE_SIZE as u64,
            program_id,
        ),
        &[admin.clone(), state_account.clone(), system_program.clone()],
        &[signer_seeds],
    )?;

    // Initialize state data
    let mut data = state_account.try_borrow_mut_data()?;
    data[0..8].copy_from_slice(&STATE_DISCRIMINATOR);
    data[8..40].copy_from_slice(admin.key.as_ref()); // admin pubkey
    data[40..72].copy_from_slice(&[0u8; 32]); // smt_root (initially zero)

    msg!("State initialized with admin: {}", admin.key);
    Ok(())
}

/// Set the SMT root for the caller's state account
///
/// Accounts:
///   0. [signer] Admin
///   1. [writable] State account (PDA: ["state", admin_pubkey])
///
/// Data: 32 bytes (new SMT root)
fn process_set_smt_root(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() != 32 {
        msg!("SMT root must be 32 bytes");
        return Err(ExclusionError::InvalidDataLength.into());
    }

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify state account PDA matches admin
    let (state_pda, _bump) =
        Pubkey::find_program_address(&[b"state", admin.key.as_ref()], program_id);
    if state_account.key != &state_pda {
        msg!("State account does not match admin's PDA");
        return Err(ExclusionError::InvalidStatePda.into());
    }

    // Verify state account discriminator
    let state_data = state_account.try_borrow_data()?;
    if state_data[0..8] != STATE_DISCRIMINATOR {
        msg!("Invalid state account");
        return Err(ExclusionError::InvalidStateAccount.into());
    }
    drop(state_data);

    // Update SMT root
    let mut state_data = state_account.try_borrow_mut_data()?;
    state_data[40..72].copy_from_slice(data);

    msg!("SMT root updated");
    Ok(())
}

/// Transfer SOL after verifying exclusion proof
///
/// Accounts:
///   0. [signer, writable] Sender (must prove NOT blacklisted)
///   1. [writable] Recipient
///   2. [] State account (contains SMT root)
///   3. [] ZK Verifier program
///   4. [] System program
///
/// Data:
///   - 8 bytes: amount (lamports)
///   - 388 bytes: ZK proof
///   - 76 bytes: public witness (must match smt_root from state + pubkey_hash from signer)
fn process_transfer_sol(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // Expected data: 8 (amount) + 388 (proof) + 76 (witness) = 472 bytes
    if data.len() != 8 + 388 + 76 {
        msg!(
            "Invalid instruction data length: expected 472, got {}",
            data.len()
        );
        return Err(ExclusionError::InvalidDataLength.into());
    }

    let account_iter = &mut accounts.iter();
    let sender = next_account_info(account_iter)?;
    let recipient = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let zk_verifier = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !sender.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify ZK verifier program ID
    if zk_verifier.key != &ZK_VERIFIER_PROGRAM_ID {
        msg!("Invalid ZK verifier program");
        return Err(ExclusionError::InvalidZkVerifier.into());
    }

    // Parse instruction data
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let proof_data = &data[8..8 + 388];
    let witness_data = &data[8 + 388..];

    // Read SMT root from state account
    let state_data = state_account.try_borrow_data()?;
    if state_data[0..8] != STATE_DISCRIMINATOR {
        msg!("Invalid state account");
        return Err(ExclusionError::InvalidStateAccount.into());
    }
    let stored_smt_root = &state_data[40..72];

    // Verify the public witness contains the correct SMT root
    // Witness format: 12-byte header + smt_root (32 bytes) + pubkey_hash (32 bytes)
    let witness_smt_root = &witness_data[12..44];
    if witness_smt_root != stored_smt_root {
        msg!("SMT root in proof does not match stored root");
        return Err(ExclusionError::SmtRootMismatch.into());
    }

    // Compute pubkey_hash from sender's pubkey using Poseidon syscall
    // Must match client's pubkeyToIndex(): poseidon(low_16_bytes, high_16_bytes)
    let pubkey_bytes = sender.key.as_ref();
    let low_bytes = &pubkey_bytes[0..16];
    let high_bytes = &pubkey_bytes[16..32];

    let computed_hash = hashv(
        Parameters::Bn254X5,
        Endianness::LittleEndian,
        &[low_bytes, high_bytes],
    )
    .map_err(|e| {
        msg!("Poseidon hash failed: {:?}", e);
        ExclusionError::PoseidonHashFailed
    })?;

    // Verify pubkey_hash in witness matches computed hash
    // LittleEndian syscall outputs little-endian, but witness from gnark is big-endian
    let witness_pubkey_hash = &witness_data[44..76];
    let computed_bytes = computed_hash.to_bytes();

    // Reverse to convert little-endian output to big-endian for comparison
    let mut computed_be = [0u8; 32];
    for i in 0..32 {
        computed_be[i] = computed_bytes[31 - i];
    }

    if witness_pubkey_hash != computed_be {
        msg!("Pubkey hash mismatch - proof is for a different pubkey");
        return Err(ExclusionError::PubkeyHashMismatch.into());
    }

    drop(state_data);

    // Build instruction data for ZK verifier: [proof][witness]
    let mut verifier_data = Vec::with_capacity(388 + 76);
    verifier_data.extend_from_slice(proof_data);
    verifier_data.extend_from_slice(witness_data);

    // CPI to ZK verifier program
    msg!("Verifying exclusion proof...");
    let verify_ix = Instruction {
        program_id: ZK_VERIFIER_PROGRAM_ID,
        accounts: vec![],
        data: verifier_data,
    };

    invoke(&verify_ix, &[])?;
    msg!("Exclusion proof verified - sender is NOT blacklisted");

    // Transfer SOL
    msg!("Transferring {} lamports to {}", amount, recipient.key);
    invoke(
        &system_instruction::transfer(sender.key, recipient.key, amount),
        &[sender.clone(), recipient.clone(), system_program.clone()],
    )?;

    msg!("Transfer complete");
    Ok(())
}
