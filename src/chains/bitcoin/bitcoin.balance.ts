// src/chains/bitcoin/bitcoin.balance.ts
//
// Read-only Bitcoin balance + UTXO loading. Balance spans BOTH the receive and
// change addresses of an account. All values are integer satoshis (bigint);
// formatting to a display string happens in bitcoin.format.ts / the adapter.

import type { BitcoinChainConfig } from "./bitcoin.config";
import { normalizeBitcoinError } from "./bitcoin.errors";
import { getAddressInfo, getAddressUtxos } from "./bitcoin.esplora";
import type {
  BitcoinAddressBalance,
  BitcoinAddressInfo,
  BitcoinBalance,
  BitcoinUtxo,
} from "./bitcoin.types";

// An (address, scriptHex) pair the wallet owns and can spend from.
export type OwnedBitcoinAddress = {
  address: string;
  scriptHex: string;
};

// Confirmed + net-pending balance for a single address, derived from its
// funded/spent stats. Pure — easy to unit test.
export function addressBalanceFromInfo(
  info: BitcoinAddressInfo,
): BitcoinAddressBalance {
  return {
    confirmedSats: info.chainFundedSats - info.chainSpentSats,
    pendingSats: info.mempoolFundedSats - info.mempoolSpentSats,
  };
}

// Aggregate per-address balances into one wallet balance. Pure.
export function sumBitcoinBalances(
  balances: BitcoinAddressBalance[],
): BitcoinBalance {
  const confirmedSats = balances.reduce(
    (sum, balance) => sum + balance.confirmedSats,
    0n,
  );
  const pendingSats = balances.reduce(
    (sum, balance) => sum + balance.pendingSats,
    0n,
  );

  return {
    confirmedSats,
    pendingSats,
    totalSats: confirmedSats + pendingSats,
  };
}

// Sum a UTXO set to a spendable total. Pure.
export function sumUtxos(utxos: BitcoinUtxo[]): bigint {
  return utxos.reduce((sum, utxo) => sum + utxo.value, 0n);
}

// Fetch and aggregate the balance across the given owned addresses (receive +
// change). One slow/failed address read throws — the adapter decides how to
// surface it.
export async function getBitcoinBalance(
  config: BitcoinChainConfig,
  addresses: string[],
): Promise<BitcoinBalance> {
  try {
    const infos = await Promise.all(
      addresses.map((address) => getAddressInfo(config, address)),
    );
    return sumBitcoinBalances(infos.map(addressBalanceFromInfo));
  } catch (error) {
    throw normalizeBitcoinError(error, "UTXO_LOAD_FAILED");
  }
}

// Load all spendable UTXOs across the given owned addresses. `includeMempool`
// keeps unconfirmed (incoming) UTXOs in the spendable set.
export async function loadBitcoinUtxos(
  config: BitcoinChainConfig,
  owned: OwnedBitcoinAddress[],
  includeMempool = true,
): Promise<BitcoinUtxo[]> {
  try {
    const perAddress = await Promise.all(
      owned.map((entry) =>
        getAddressUtxos(config, entry.address, entry.scriptHex),
      ),
    );

    const utxos = perAddress.flat();
    return includeMempool ? utxos : utxos.filter((utxo) => utxo.confirmed);
  } catch (error) {
    throw normalizeBitcoinError(error, "UTXO_LOAD_FAILED");
  }
}
