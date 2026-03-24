import type { WalletType, WalletProvider, ShellAuthWindow } from '../types/auth-types.js';

export function parseChainId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.startsWith('0x')) {
      const parsedHex = Number.parseInt(value, 16);
      return Number.isFinite(parsedHex) ? parsedHex : undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function resolveWalletProvider(walletType: WalletType): WalletProvider | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const win = window as ShellAuthWindow;
  if (walletType === 'metamask') {
    const provider = win.ethereum;
    if (!provider) {
      return null;
    }

    if (provider.isMetaMask) {
      return provider;
    }

    const nested = provider.providers?.find((candidate) => candidate?.isMetaMask);
    return nested ?? null;
  }

  if (walletType === 'okx') {
    const provider = win.okxwallet || win.ethereum;
    if (!provider) {
      return null;
    }

    if (
      provider === win.okxwallet
      || provider.isOkxWallet
      || provider.isOKXWallet
      || provider.isOkx
    ) {
      return provider;
    }

    const nested = provider.providers?.find((candidate) =>
      candidate?.isOkxWallet || candidate?.isOKXWallet || candidate?.isOkx);
    return nested ?? null;
  }

  const provider = win.BinanceChain || win.binanceWallet || win.ethereum;
  if (!provider) {
    return null;
  }

  if (
    provider === win.BinanceChain
    || provider === win.binanceWallet
    || provider.isBinance
    || provider.isBinanceWallet
    || provider.isBinanceChain
  ) {
    return provider;
  }

  const nested = provider.providers?.find((candidate) =>
    candidate?.isBinance || candidate?.isBinanceWallet || candidate?.isBinanceChain);
  return nested ?? null;
}
