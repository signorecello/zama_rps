import { createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk/node';
import { ROCK, PAPER, SCISSORS } from "./constants";
import { hexlify } from 'ethers';

const moveMap: { [key: string]: number } = {
  rock: ROCK,
  paper: PAPER,
  scissors: SCISSORS,
};

async function main() {
  const args = process.argv.slice(2);

  const contractAddress = args[0];
  const playerAddress = args[1];
  const moveInput = args[2];

  const move = moveMap[moveInput];

  const fhevm = await createInstance(SepoliaConfig);
  const encryptedMove = await fhevm
    .createEncryptedInput(contractAddress, playerAddress)
    .add8(move)
    .encrypt();

  console.log("Handle:", hexlify(encryptedMove.handles[0]));
  console.log("Input Proof:", hexlify(encryptedMove.inputProof));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
