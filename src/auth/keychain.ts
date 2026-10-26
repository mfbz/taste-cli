// The system keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux) behind a
// three-method seam, so tests use a double and commands that never touch credentials never load the
// native binding.

type KeychainLike = {
  // null: no entry. Throws when the keychain itself can't be used (none, locked, no native binary).
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
};

const SERVICE = "taste-cli";
const ACCOUNT = "default";

// null when the native module can't load on this platform; the store then falls back to a file.
async function loadKeychain(): Promise<KeychainLike | null> {
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    const entry = new AsyncEntry(SERVICE, ACCOUNT);
    return {
      get: () => entry.getPassword(),
      set: (value) => entry.setPassword(value),
      delete: async () => {
        await entry.deleteCredential();
      },
    };
  } catch {
    return null;
  }
}

export { loadKeychain };
export type { KeychainLike };
