import { isIP } from 'node:net';

export function resolveReferenceNetwork(input: {
  websiteOrigin?: string;
  bindHost?: string;
  officialWebOrigin: string;
}) {
  const origin = exactOrigin(input.websiteOrigin ?? 'https://127.0.0.1:4443', false);
  const official = exactOrigin(input.officialWebOrigin, true);
  if (origin.hostname === official.hostname) {
    throw new Error('The website and official Nimi login need different hostnames; ports do not isolate cookies.');
  }
  const bindHost = input.bindHost ?? '127.0.0.1';
  if (!isIP(bindHost)) throw new Error('REFERENCE_BIND_HOST must be an explicit local IP address.');
  return { origin, bindHost, officialWebBaseUrl: official.origin };
}

function exactOrigin(value: string, allowLoopbackHttp: boolean): URL {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLoopbackHttp && loopback && url.protocol === 'http:'))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an exact HTTPS origin; HTTP is allowed only for the official loopback development login.');
  }
  return url;
}
