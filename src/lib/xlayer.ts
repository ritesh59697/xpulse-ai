// src/lib/xlayer.ts
import { ethers } from "ethers";

export const NETWORKS = {
  testnet: {
    rpc:      "https://testrpc.xlayer.tech/terigon",
    chainId:  1952,
    name:     "xlayer-testnet",
    explorer: "https://www.oklink.com/x-layer-testnet",
  },
  mainnet: {
    rpc:      "https://rpc.xlayer.tech",
    chainId:  196,
    name:     "xlayer",
    explorer: "https://www.oklink.com/xlayer",
  },
};

export const ACTIVE = NETWORKS[
  (process.env.X_LAYER_NETWORK as keyof typeof NETWORKS) ?? "mainnet"
] ?? NETWORKS.mainnet;

export function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    process.env.X_LAYER_RPC_URL || ACTIVE.rpc,
    { chainId: ACTIVE.chainId, name: ACTIVE.name }
  );
}

export function getAgentWallet(): ethers.Wallet {
  const raw = process.env.AGENT_PRIVATE_KEY;
  if (!raw) throw new Error("AGENT_PRIVATE_KEY not set in .env.local");
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  return new ethers.Wallet(key, getProvider());
}

export function getAgentWalletAddress(): string {
  return getAgentWallet().address;
}

export function getTxExplorerUrl(txHash: string): string {
  return `${ACTIVE.explorer}/tx/${txHash}`;
}

export function getAddressExplorerUrl(address: string): string {
  return `${ACTIVE.explorer}/address/${address}`;
}

export async function assertXLayerNetwork(
  provider: ethers.Provider = getProvider()
): Promise<void> {
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== ACTIVE.chainId) {
    throw new Error(
      `Wrong chain: got ${network.chainId}, expected ${ACTIVE.chainId} (${ACTIVE.name})`
    );
  }
}
