import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { RockPaperScissors } from "../typechain-types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ROCK, PAPER, SCISSORS, NO_ERROR, INVALID_MOVE } from "../utils/constants";

describe("RockPaperScissors", function () {
  let RPS: RockPaperScissors;
  let RPSAddress: string;

  let alice: { id: number; signer: HardhatEthersSigner };
  let bob: { id: number; signer: HardhatEthersSigner };

  // helper function to submit encrypted move and check for errors
  async function submitEncryptedMove(
    player: { id: number; signer: HardhatEthersSigner },
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

    // check error code
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
    const [aliceSigner, bobSigner] = await ethers.getSigners();

    alice = {
      id: 1,
      signer: aliceSigner
    };

    bob = {
      id: 2,
      signer: bobSigner
    };

    // constructor takes both addresses as players (like "registering")
    RPS = await ethers.deployContract("RockPaperScissors", [
      await alice.signer.getAddress(),
      await bob.signer.getAddress()
    ]) as RockPaperScissors;
    await RPS.waitForDeployment();
    RPSAddress = await RPS.getAddress();
  });

  it("Should set error for invalid moves", async function () {
    // test invalid move = 3 (player 1)
    // actually 3 is NO_MOVE but NO_MOVE is still invalid
    await submitEncryptedMove(alice, 3, INVALID_MOVE);

    // test invalid move = 255 (player 2)
    await submitEncryptedMove(bob, 255, INVALID_MOVE);
  });

  it("Should prevent a player from submitting twice in one round", async function () {
    // alice submits first (becomes player 1)
    await submitEncryptedMove(alice, ROCK);

    // alice tries to submit again in the same round - should fail
    await expect(
      submitEncryptedMove(alice, PAPER)
    ).to.be.revertedWith("Player 1 already submitted this round");
  });

  it("Should prevent third party from submitting", async function () {
    const [, , charlie] = await ethers.getSigners();
    const charlieAddress = await charlie.getAddress();

    const encryptedMove = await hre.fhevm
      .createEncryptedInput(RPSAddress, charlieAddress)
      .add8(PAPER)
      .encrypt();

    // charlie tries to submit - should fail
    await expect(
      RPS.connect(charlie).submitMove(
        encryptedMove.handles[0],
        encryptedMove.inputProof
      )
    ).to.be.revertedWith("Only registered players can submit moves");
  });

  it("Should play a complete 3-round game", async function () {
    // round 1: rock vs scissors (alice wins)
    await submitEncryptedMove(alice, ROCK);
    await submitEncryptedMove(bob, SCISSORS);

    const game1 = await RPS.game();
    expect(game1.currentRound).to.equal(1);
    expect(game1.gameEnded).to.equal(false);

    // round 2: paper vs rock (alice wins)
    await submitEncryptedMove(alice, PAPER);
    await submitEncryptedMove(bob, ROCK);

    const game2 = await RPS.game();
    expect(game2.currentRound).to.equal(2);
    expect(game2.gameEnded).to.equal(false);

    // round 3: scissors vs paper (alice wins)
    await submitEncryptedMove(alice, SCISSORS);
    await submitEncryptedMove(bob, PAPER);

    // game should be ended after 3 rounds
    const game3 = await RPS.game();
    expect(game3.currentRound).to.equal(3);
    expect(game3.gameEnded).to.equal(true);

    // Get and decrypt winner
    const encryptedWinner = game3.winner;
    const clearWinner = await hre.fhevm.userDecryptEuint(
      FhevmType.euint8,
      encryptedWinner,
      RPSAddress,
      alice.signer
    );

    // alice wins all 3 rounds: rock > scissors, paper > rock, scissors > paper
    expect(clearWinner).to.equal(1n); // alice wins

    // try to submit move after game ended - should revert
    await expect(
      submitEncryptedMove(alice, ROCK)
    ).to.be.revertedWith("Game has ended");
  });

  it("Should play a complete 3-round game - Bob wins", async function () {
    // round 1: rock vs scissors (bob wins)
    await submitEncryptedMove(alice, ROCK);
    await submitEncryptedMove(bob, SCISSORS);

    const game1 = await RPS.game();
    expect(game1.currentRound).to.equal(1);
    expect(game1.gameEnded).to.equal(false);

    //  round 2: scissors vs rock (bob wins)
    await submitEncryptedMove(alice, SCISSORS);
    await submitEncryptedMove(bob, ROCK);

    const game2 = await RPS.game();
    expect(game2.currentRound).to.equal(2);
    expect(game2.gameEnded).to.equal(false);

    // round 3: rock vs paper (bob wins)
    await submitEncryptedMove(alice, ROCK);
    await submitEncryptedMove(bob, PAPER);

    // game should be ended after 3 rounds
    const game3 = await RPS.game();
    expect(game3.currentRound).to.equal(3);
    expect(game3.gameEnded).to.equal(true);

    // Get and decrypt winner
    const encryptedWinner = game3.winner;
    const clearWinner = await hre.fhevm.userDecryptEuint(
      FhevmType.euint8,
      encryptedWinner,
      RPSAddress,
      bob.signer
    );

    // bob wins 2-1: alice wins round 1, bob wins rounds 2 and 3
    expect(clearWinner).to.equal(2n); // bob wins
  });
});
