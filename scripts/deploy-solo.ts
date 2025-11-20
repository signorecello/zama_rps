import { ethers } from "hardhat";

async function main() {
  console.log("Deploying RockPaperScissorsSolo contract...");

  const [deployer] = await ethers.getSigners();
  const playerAddress = await deployer.getAddress();

  console.log(`Player address: ${playerAddress}`);

  const RPS = await ethers.deployContract("RockPaperScissorsSolo", [playerAddress]);
  await RPS.waitForDeployment();

  const address = await RPS.getAddress();
  console.log(`RockPaperScissorsSolo deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
