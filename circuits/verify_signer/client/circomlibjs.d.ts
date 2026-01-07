declare module "circomlibjs" {
  export interface PoseidonField {
    toObject(val: unknown): bigint;
  }

  export interface Poseidon {
    (inputs: bigint[]): unknown;
    F: PoseidonField;
  }

  export function buildPoseidon(): Promise<Poseidon>;
}
