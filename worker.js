// RikyFreeMintGuard — ZKVerify Agent Games Wildcard entry.
// A read-only agent that verifies a claimed "free mint" on-chain BEFORE
// anyone signs: contract kind, liveness, supply, mint price, paused state.
// No wallet, no signing, no secrets. Every verdict cites on-chain evidence
// (values + block number) so a judge can re-check it independently.
//
// POST /verify  { chain, contract, wallet? }  -> verdict + evidence
// GET  /        -> health
//
// Chains: bsc, ethereum, base, sepolia, base-sepolia
// Theme: Agentic Commerce — helps someone EARN (free mints) without getting
// drained by a fake "free" mint.

const RPCS = {
  bsc: "https://bsc-dataseed.bnbchain.org",
  ethereum: "https://ethereum.publicnode.com",
  base: "https://mainnet.base.org",
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
  "base-sepolia": "https://sepolia.base.org",
};

const SEL = {
  supportsInterface: "0x01ffc9a7",
  totalSupply: "0x18160ddd",
  maxSupply: "0xd5abeb01",
  MAX_SUPPLY: "0x32cb6b0c",
  price: "0xa035b1fe",
  mintPrice: "0x6817c76c",
  cost: "0x13faede6",
  paused: "0x5c975abb",
  owner: "0x8da5cb5b",
  balanceOf: "0x70a08231",
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
};

// 4-byte selectors whose presence in runtime bytecode hints a mint entry point.
const MINT_SELECTORS = {
  "mint(uint256)": "a0712d68",
  "claim()": "4e71d92d",
  "freeMint()": "5b70ea9f",
  "mint(address,uint256)": "40c10f19",
};

const ERC721 = "80ac58cd";
const ERC1155 = "d9b67a26";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

function isAddress(a) {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}

function padAddress(a) {
  return "0x" + a.slice(2).toLowerCase().padStart(64, "0");
}

function padBytes4(hex4) {
  return "0x" + hex4.padStart(64, "0");
}

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

async function ethCall(url, to, data) {
  try {
    const res = await rpc(url, "eth_call", [{ to, data }, "latest"]);
    return res; // hex or null
  } catch {
    return null;
  }
}

function decodeUint(hex) {
  if (!hex || hex === "0x") return null;
  try {
    return BigInt(hex).toString();
  } catch {
    return null;
  }
}

function decodeBool(hex) {
  const v = decodeUint(hex);
  return v === null ? null : v !== "0";
}

function decodeString(hex) {
  if (!hex || hex === "0x" || hex.length < 130) return null;
  try {
    const len = parseInt(hex.slice(66, 130), 16);
    if (!Number.isFinite(len) || len <= 0 || len > 1000) return null;
    const bytes = hex.slice(130, 130 + len * 2);
    let out = "";
    for (let i = 0; i < bytes.length; i += 2) {
      out += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
    }
    return out;
  } catch {
    return null;
  }
}

async function verify(chain, contract, wallet) {
  const rpcUrl = RPCS[chain];
  const evidence = {};
  const reasons = [];
  let verdict = "GO";

  // 1. Contract exists?
  const code = await rpc(rpcUrl, "eth_getCode", [contract, "latest"]).catch(() => null);
  evidence.codePresent = !!code && code !== "0x" && code.length > 2;
  if (!evidence.codePresent) {
    return {
      verdict: "AVOID",
      reasons: ["No contract code at this address on " + chain + " — nothing to mint."],
      evidence,
    };
  }
  evidence.codeBytes = (code.length - 2) / 2;

  // 2. Token standard (ERC165).
  const supports721 = await ethCall(rpcUrl, contract, SEL.supportsInterface + padBytes4(ERC721).slice(2));
  const supports1155 = await ethCall(rpcUrl, contract, SEL.supportsInterface + padBytes4(ERC1155).slice(2));
  evidence.erc721 = decodeBool(supports721);
  evidence.erc1155 = decodeBool(supports1155);
  evidence.standard = evidence.erc721 ? "ERC721" : evidence.erc1155 ? "ERC1155" : "unknown";

  // 3. Name / symbol (best effort).
  evidence.name = decodeString(await ethCall(rpcUrl, contract, SEL.name));
  evidence.symbol = decodeString(await ethCall(rpcUrl, contract, SEL.symbol));

  // 4. Supply.
  evidence.totalSupply = decodeUint(await ethCall(rpcUrl, contract, SEL.totalSupply));
  evidence.maxSupply =
    decodeUint(await ethCall(rpcUrl, contract, SEL.maxSupply)) ||
    decodeUint(await ethCall(rpcUrl, contract, SEL.MAX_SUPPLY));

  // 5. Mint price (best effort — try the common getters).
  let price = null;
  let priceSource = null;
  for (const [label, sel] of [["price()", SEL.price], ["mintPrice()", SEL.mintPrice], ["cost()", SEL.cost]]) {
    const v = decodeUint(await ethCall(rpcUrl, contract, sel));
    if (v !== null) {
      price = v;
      priceSource = label;
      break;
    }
  }
  evidence.mintPriceWei = price;
  evidence.mintPriceSource = priceSource;

  // 6. Paused?
  evidence.paused = decodeBool(await ethCall(rpcUrl, contract, SEL.paused));

  // 7. Owner (informational).
  const ownerRaw = await ethCall(rpcUrl, contract, SEL.owner);
  evidence.owner = ownerRaw && ownerRaw !== "0x" ? "0x" + ownerRaw.slice(-40) : null;

  // 8. Mint entry points visible in bytecode?
  const codeLower = code.toLowerCase();
  evidence.mintFunctions = Object.entries(MINT_SELECTORS)
    .filter(([, sel]) => codeLower.includes(sel))
    .map(([name]) => name);

  // 9. Wallet already holds?
  if (wallet) {
    evidence.walletBalance = decodeUint(
      await ethCall(rpcUrl, contract, SEL.balanceOf + padAddress(wallet).slice(2))
    );
  }

  // 10. Latest block (so the verdict is reproducible).
  try {
    evidence.blockNumber = parseInt(await rpc(rpcUrl, "eth_blockNumber", []), 16);
  } catch {
    evidence.blockNumber = null;
  }

  // ---- Verdict ----
  if (evidence.paused === true) {
    verdict = "AVOID";
    reasons.push("Contract is PAUSED — minting is disabled right now.");
  }
  if (evidence.totalSupply !== null && evidence.maxSupply !== null) {
    if (BigInt(evidence.totalSupply) >= BigInt(evidence.maxSupply)) {
      verdict = "AVOID";
      reasons.push(
        "SOLD OUT — totalSupply (" + evidence.totalSupply + ") reached maxSupply (" + evidence.maxSupply + ")."
      );
    } else {
      reasons.push(
        "Supply left: " + (BigInt(evidence.maxSupply) - BigInt(evidence.totalSupply)).toString() + " of " + evidence.maxSupply + "."
      );
    }
  }
  if (evidence.mintPriceWei !== null) {
    if (evidence.mintPriceWei !== "0") {
      if (verdict !== "AVOID") verdict = "CAUTION";
      reasons.push(
        "NOT FREE — " + evidence.mintPriceSource + " = " + evidence.mintPriceWei + " wei. A 'free' claim with a price is a red flag."
      );
    } else {
      reasons.push("Mint price reads 0 (" + evidence.mintPriceSource + ") — genuinely free on-chain.");
    }
  } else {
    if (verdict !== "AVOID") verdict = "CAUTION";
    reasons.push("Mint price could not be read (no price()/mintPrice()/cost() getter) — confirm the cost manually before signing.");
  }
  if (evidence.standard === "unknown") {
    if (verdict === "GO") verdict = "CAUTION";
    reasons.push("Token standard unknown (not ERC721/ERC1155 via ERC165) — verify what this contract actually is.");
  }
  if (evidence.mintFunctions.length === 0) {
    if (verdict === "GO") verdict = "CAUTION";
    reasons.push("No common mint/claim entry point found in the bytecode — check how minting is supposed to work.");
  }
  if (wallet && evidence.walletBalance !== null && evidence.walletBalance !== "0") {
    reasons.push("Wallet already holds " + evidence.walletBalance + " token(s) of this collection.");
  }
  if (evidence.standard !== "unknown" && reasons.length === 0) {
    reasons.push("Contract is live and readable.");
  }

  return { verdict, reasons, evidence };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      return json({
        ok: true,
        agent: "freemint-guard",
        version: "1",
        usage: "POST /verify { chain: 'bsc'|'ethereum'|'base'|'sepolia'|'base-sepolia', contract: '0x...', wallet: '0x...' (optional) }",
      });
    }

    if (request.method === "POST" && url.pathname === "/verify") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const { chain, contract, wallet } = body || {};
      if (!chain || !RPCS[chain]) {
        return json({ error: "Unknown chain. Use one of: " + Object.keys(RPCS).join(", ") + "." }, 400);
      }
      if (!isAddress(contract)) {
        return json({ error: "contract must be a valid 0x address." }, 400);
      }
      if (wallet !== undefined && wallet !== null && !isAddress(wallet)) {
        return json({ error: "wallet must be a valid 0x address." }, 400);
      }
      try {
        const result = await verify(chain, contract.toLowerCase(), wallet ? wallet.toLowerCase() : null);
        return json({
          agent: "freemint-guard",
          version: "1",
          chain,
          contract: contract.toLowerCase(),
          wallet: wallet ? wallet.toLowerCase() : null,
          ...result,
        });
      } catch (e) {
        return json({ error: "Verification failed: " + (e && e.message ? e.message : "unknown error") }, 502);
      }
    }

    return json({ error: "Not found. GET / for usage, POST /verify to verify a mint." }, 404);
  },
};
