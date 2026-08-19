import {
  deployer,
  clientFor,
  contractSource,
  fund,
  balanceOf,
  saveDeployment,
  awaitTx,
  step,
  ok,
  log,
  fmtGen,
  RPC,
} from "./lib.mjs";

const FEE_BPS = 200; // 2% platform fee
const STRICT_VISION = false; // see contracts/varigate.py — Studio runs a mixed validator set

const account = deployer();
const client = clientFor(account);
const treasury = process.env.TREASURY_ADDRESS?.trim() || account.address;

step("VariGate → GenLayer Studio");
log(`  rpc       ${RPC}`);
log(`  deployer  ${account.address}`);
log(`  treasury  ${treasury}`);
log(`  fee       ${FEE_BPS / 100}%`);

let balance = await balanceOf(account.address);
if (balance < 10n ** 19n) {
  step("Topping up the deployer from the Studio faucet");
  await fund(account.address, 500);
  balance = await balanceOf(account.address);
}
ok(`balance ${fmtGen(balance)} GEN`);

step("Compiling and deploying");
const code = contractSource();
await client.getContractSchemaForCode(code);
ok(`schema valid (${code.length} bytes of Python)`);

const hash = await client.deployContract({
  code,
  args: [treasury, FEE_BPS, STRICT_VISION],
});
const receipt = await awaitTx(client, hash, "deploy");
const address = receipt.data?.contract_address ?? receipt.recipient;
if (!address) throw new Error(`deploy produced no address: ${JSON.stringify(receipt).slice(0, 400)}`);

const config = await client.readContract({ address, functionName: "get_config", args: [] });

saveDeployment({
  network: "studionet",
  chainId: 61999,
  address,
  deployer: account.address,
  treasury,
  feeBps: FEE_BPS,
  strictVision: STRICT_VISION,
  deployTx: hash,
  deployedAt: new Date().toISOString(),
});

step("Deployed");
log(`  address   \x1b[1m${address}\x1b[0m`);
log(`  config    ${config}`);
log(`\n  Written to deployments/studionet.json and VITE_CONTRACT_ADDRESS in .env.local`);
log(`  Next: \x1b[1mnpm run seed\x1b[0m to populate demo listings, or \x1b[1mnpm run dev\x1b[0m\n`);
