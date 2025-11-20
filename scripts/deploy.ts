import { ethers } from "hardhat";

async function main() {
  console.log("Deploying RockPaperScissors contract...");

  const [alice, bob] = await ethers.getSigners();

  console.log(`Alice address: ${alice.getAddress()}`);
  console.log(`Bob address: ${bob.getAddress()}`);

  const RPS = await ethers.deployContract("RockPaperScissors", [alice.getAddress(), bob.getAddress()]);
  await RPS.waitForDeployment();

  const address = await RPS.getAddress();
  console.log(`RockPaperScissors deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
