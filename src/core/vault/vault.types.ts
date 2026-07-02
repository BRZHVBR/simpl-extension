// src/core/vault/vault.types.ts

export type VaultVersion = 1;

export type VaultKdfName = "PBKDF2";
export type VaultCipherName = "AES-GCM";

// Secret material for an imported account, kept ONLY inside the encrypted
// vault (never on the plaintext account record or in localStorage). Resolved by
// account id at signing time. `id` matches the WalletAccount id.
export type ImportedAccountSecret =
  | {
      id: string;
      type: "privateKey";
      privateKey: string;
    }
  | {
      id: string;
      type: "importedMnemonic";
      mnemonic: string;
      index: number;
    };

export type VaultPayload = {
  mnemonic: string;
  createdAt: string;
  // Present once the user imports external wallets. Optional so existing
  // single-seed vaults decrypt unchanged.
  importedAccounts?: ImportedAccountSecret[];
};

export type EncryptedVault = {
  version: VaultVersion;
  kdf: {
    name: VaultKdfName;
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: VaultCipherName;
    iv: string;
    ciphertext: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type CreateVaultInput = {
  mnemonic: string;
  password: string;
};

export type UnlockVaultInput = {
  encryptedVault: EncryptedVault;
  password: string;
};

export type ChangeVaultPasswordInput = {
  encryptedVault: EncryptedVault;
  oldPassword: string;
  newPassword: string;
};