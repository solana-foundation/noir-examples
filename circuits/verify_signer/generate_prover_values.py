import hashlib

from ecdsa import SECP256k1, SigningKey
from ecdsa.util import sigencode_string

# Generate a random private key
sk = SigningKey.generate(curve=SECP256k1)
vk = sk.get_verifying_key()

# Get the public key coordinates (32 bytes each)
public_key_x = vk.to_string()[:32]
public_key_y = vk.to_string()[32:]

# Create a message and hash it
message = b"Hello, Noir!"
hashed_message = hashlib.sha256(message).digest()

# Sign the hash - use sigencode_string for raw r||s bytes
signature = sk.sign_digest(hashed_message, sigencode=sigencode_string)


# Format as Noir array strings
def to_noir_array(data):
    return "[" + ", ".join(f'"{b}"' for b in data) + "]"


print("hashed_message =", to_noir_array(hashed_message))
print("public_key_x =", to_noir_array(public_key_x))
print("public_key_y =", to_noir_array(public_key_y))
print("signature =", to_noir_array(signature))
