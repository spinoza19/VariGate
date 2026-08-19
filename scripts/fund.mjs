/**
 * Top an address up from the Studio faucet.
 *
 *   npm run fund                 -- the deployer
 *   npm run fund -- 0xabc… 500   -- any address, any amount
 */
import { deployer, fund, balanceOf, step, ok, log, fmtGen } from "./lib.mjs";

const address = process.argv[2] ?? deployer().address;
const amount = Number(process.argv[3] ?? 500);

step(`Funding ${address}`);
log(`  before  ${fmtGen(await balanceOf(address))} GEN`);
await fund(address, amount);
await new Promise((r) => setTimeout(r, 1500));
ok(`after   ${fmtGen(await balanceOf(address))} GEN`);
