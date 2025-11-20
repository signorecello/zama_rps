// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {FHE, euint8, externalEuint8, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

struct LastError {
  euint8 error;
  uint timestamp;
}

struct Player {
    address playerAddress;
    euint8 move;
    bool submitted;
    euint8 score;
}

struct Game {
    Player player1;
    Player player2;
    euint8 winner;
    uint8 currentRound;
    bool gameEnded;
}

contract RockPaperScissors is ZamaEthereumConfig {
    euint8 public ZERO; // rock
    euint8 public ONE;  // paper
    euint8 public TWO;  // scissors
    euint8 public NO_MOVE; // no move

    Game public game;
    uint8 public constant MAX_ROUNDS = 3;

    mapping(address => LastError) private _lastErrors;

    euint8 internal NO_ERROR;
    euint8 internal INVALID_MOVE;

    event ErrorChanged(address indexed user);
    event RoundResult(uint8 round, address indexed caller);
    event GameEnded(address indexed caller);

    constructor(address _player1, address _player2) {
        require(_player1 != address(0) && _player2 != address(0), "Invalid player addresses");
        require(_player1 != _player2, "Players must be different");

        ZERO = FHE.asEuint8(0);
        ONE = FHE.asEuint8(1);
        TWO = FHE.asEuint8(2);
        NO_MOVE = FHE.asEuint8(3);

        NO_ERROR = FHE.asEuint8(0);
        INVALID_MOVE = FHE.asEuint8(1);

        FHE.allowThis(ZERO);
        FHE.allowThis(ONE);
        FHE.allowThis(TWO);
        FHE.allowThis(NO_MOVE);
        FHE.allowThis(NO_ERROR);
        FHE.allowThis(INVALID_MOVE);

        Player memory player1 = Player({playerAddress: _player1, move: NO_MOVE, submitted: false, score: ZERO});
        Player memory player2 = Player({playerAddress: _player2, move: NO_MOVE, submitted: false, score: ZERO});

        game = Game({player1: player1, player2: player2, winner: ZERO, currentRound: 0, gameEnded: false});

        FHE.allowThis(game.player1.move);
        FHE.allowThis(game.player2.move);
        FHE.allowThis(game.player1.score);
        FHE.allowThis(game.player2.score);
        FHE.allowThis(game.winner);
    }

    function setLastError(euint8 error, address addr) private {
        _lastErrors[addr] = LastError(error, block.timestamp);
        FHE.allowThis(error);
        FHE.allow(error, addr);
        emit ErrorChanged(addr);
    }

    function getLastError(address addr) public view returns (euint8) {
        return _lastErrors[addr].error;
    }

    function submitMove(externalEuint8 playerMove, bytes calldata inputProof) public {
        require(!game.gameEnded, "Game has ended");
        require(game.currentRound < MAX_ROUNDS, "Max rounds reached");

        euint8 move = FHE.fromExternal(playerMove, inputProof);

        FHE.allowThis(move);

        // euint8 can't be < 0, so let's just check the upper bound
        ebool isInvalid = FHE.gt(move, TWO);
        setLastError(FHE.select(isInvalid, INVALID_MOVE, NO_ERROR), msg.sender);

        if (msg.sender == game.player1.playerAddress) {
            require(!game.player1.submitted, "Player 1 already submitted this round");
            game.player1.move = move;
            game.player1.submitted = true;
            FHE.allowThis(game.player1.move);
        } else if (msg.sender == game.player2.playerAddress) {
            require(!game.player2.submitted, "Player 2 already submitted this round");
            game.player2.move = move;
            game.player2.submitted = true;
            FHE.allowThis(game.player2.move);
        } else {
            revert("Only registered players can submit moves");
        }

        // if both players have submitted
        if (game.player1.submitted && game.player2.submitted) {
            // Check for draw first, makes it easy later on
            ebool isDraw = FHE.eq(game.player1.move, game.player2.move);

            // onlyu need to check for p1 wins, p2 wins is the opposite
            // Player 1 wins scenarios:
            // Rock (0) beats Scissors (2)
            // Paper (1) beats Rock (0)
            // Scissors (2) beats Paper (1)

            ebool p1IsRock = FHE.eq(game.player1.move, ZERO);
            ebool p2IsScissors = FHE.eq(game.player2.move, TWO);
            ebool p1IsRockWins = FHE.and(p1IsRock, p2IsScissors);

            ebool p1IsPaper = FHE.eq(game.player1.move, ONE);
            ebool p2IsRock = FHE.eq(game.player2.move, ZERO);
            ebool p1IsPaperWins = FHE.and(p1IsPaper, p2IsRock);

            ebool p1IsScissors = FHE.eq(game.player1.move, TWO);
            ebool p2IsPaper = FHE.eq(game.player2.move, ONE);
            ebool p1IsScissorsWins = FHE.and(p1IsScissors, p2IsPaper);

            ebool p1Wins = FHE.or(FHE.or(p1IsRockWins, p1IsPaperWins), p1IsScissorsWins);

            // assign scores: 1 for winner, 0 for draw or loser
            euint8 p1RoundScore = FHE.select(isDraw, ZERO, FHE.select(p1Wins, ONE, ZERO));
            euint8 p2RoundScore = FHE.select(isDraw, ZERO, FHE.select(p1Wins, ZERO, ONE));

            // update scores
            game.player1.score = FHE.add(game.player1.score, p1RoundScore);
            game.player2.score = FHE.add(game.player2.score, p2RoundScore);

            FHE.allowThis(game.player1.score);
            FHE.allowThis(game.player2.score);
            FHE.allow(game.player1.score, game.player1.playerAddress);
            FHE.allow(game.player1.score, game.player2.playerAddress);
            FHE.allow(game.player2.score, game.player1.playerAddress);
            FHE.allow(game.player2.score, game.player2.playerAddress);

            // increment round counter and reset submission trackers
            game.currentRound++;
            game.player1.submitted = false;
            game.player2.submitted = false;

            // reset moves for next round
            game.player1.move = NO_MOVE;
            game.player2.move = NO_MOVE;

            // check if game should end
            if (game.currentRound == MAX_ROUNDS) {
                game.gameEnded = true;

                // determine winner: 0 = tie, 1 = player1, 2 = player2
                ebool p1HasHigherScore = FHE.gt(game.player1.score, game.player2.score);
                ebool p2HasHigherScore = FHE.gt(game.player2.score, game.player1.score);
                game.winner = FHE.select(p1HasHigherScore, ONE, FHE.select(p2HasHigherScore, TWO, ZERO));

                FHE.allowThis(game.winner);
                FHE.allow(game.winner, game.player1.playerAddress);
                FHE.allow(game.winner, game.player2.playerAddress);

                FHE.makePubliclyDecryptable(game.winner);
                emit GameEnded(msg.sender);
            }

            emit RoundResult(game.currentRound, msg.sender);
        }
    }
}
