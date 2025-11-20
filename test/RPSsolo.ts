import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { RockPaperScissorsSolo } from "../typechain-types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ROCK, PAPER, SCISSORS, NO_ERROR, INVALID_MOVE } from "../utils/constants";

describe("RockPaperScissorsSolo", function () {
  let RPS: RockPaperScissorsSolo;
  let RPSAddress: string;

  // alice plays solo now
  let alice: { signer: HardhatEthersSigner };

  // helper function to submit encrypted move and check for errors
  async function submitEncryptedMove(
    player: { signer: HardhatEthersSigner },
    move: number,
    expectedError: bigint = NO_ERROR
  ) {
    const signerAddress = await player.signer.getAddress();

    const encryptedMove = await hre.fhevm
      .createEncryptedInput(RPSAddress, signerAddress)
      .add8(move)
      .encrypt();

    const tx = await RPS.connect(player.signer).submitMove(
      encryptedMove.handles[0],
      encryptedMove.inputProof
    );
    await tx.wait();

    const encryptedError = await RPS.getLastError(signerAddress);
    const clearError = await hre.fhevm.userDecryptEuint(
      FhevmType.euint8,
      encryptedError,
      RPSAddress,
      player.signer
    );
    expect(clearError).to.equal(expectedError);
  }

  beforeEach(async function () {
    const [aliceSigner] = await ethers.getSigners();

    alice = {
      signer: aliceSigner
    };

    // same as the two player but only one "registered", maybe this could be the deployer actually
    RPS = await ethers.deployContract("RockPaperScissorsSolo", [
      await alice.signer.getAddress()
    ]) as RockPaperScissorsSolo;
    await RPS.waitForDeployment();
    RPSAddress = await RPS.getAddress();
  });

  it("Should set error for invalid moves", async function () {
    await submitEncryptedMove(alice, 3, INVALID_MOVE);
    await submitEncryptedMove(alice, 255, INVALID_MOVE);
  });

  it("Should play a complete 3-round game", async function () {
    // play 3 rounds (results are random, but we test the flow)
    await submitEncryptedMove(alice, ROCK);
    const game1 = await RPS.game();
    expect(game1.currentRound).to.equal(1);
    expect(game1.gameEnded).to.equal(false);

    await submitEncryptedMove(alice, PAPER);
    const game2 = await RPS.game();
    expect(game2.currentRound).to.equal(2);
    expect(game2.gameEnded).to.equal(false);

    await submitEncryptedMove(alice, SCISSORS);

    // game should be ended after 3 rounds
    const game3 = await RPS.game();
    expect(game3.currentRound).to.equal(3);
    expect(game3.gameEnded).to.equal(true);

    // get and decrypt winner
    const encryptedWinner = game3.winner;
    const clearWinner = await hre.fhevm.userDecryptEuint(
      FhevmType.euint8,
      encryptedWinner,
      RPSAddress,
      alice.signer
    );

    // winner should be 0 (tie), 1 (player), or 2 (computer)
    expect(clearWinner).to.be.oneOf([0n, 1n, 2n]);

    // try to play after game ended - should revert
    await expect(
      submitEncryptedMove(alice, ROCK)
    ).to.be.revertedWith("Game has ended");
  });
});
