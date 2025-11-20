# System Design

## Architecture Overview

This project implements a confidential Rock-Paper-Scissors game using Zama's FHEVM. There are two, very similar versions of the same game: a solo version, and a two-player version. Both versions of the game follow the same logic:

- 3 rounds per game (configurable)
- Each player encrypts their move off-chain and submits it to the contract along with a validity ZK proof
- Once the two players submit their moves (or one if playing solo), the contract compares them and updates the scores, which remain encrypted
- When the game ends, the winner is revealed

## Design decisions

Initially, I've thought of an old trick for Rock-Paper-Scissors I'd stumbled upon a few years back. If you represent: 

- 0, 1, and 2 as rock/paper/scissors
- 0, 1, and 2 as the winner (0 = draw, 1 = p1 wins, 2 = p2 wins)

Then you can always do `(3 + p1_move - p2_move) % 3` to get the winner:

- p1 plays rock, p2 plays paper: `(3 + 0 - 1) % 3 = 2` (p2 wins)
- p1 plays paper, p2 plays scissors: `(3 + 1 - 2) % 3 = 2` (p2 wins)
- p1 plays scissors, p2 plays rock: `(3 + 2 - 0) % 3 = 2` (p2 wins)
- both play rock: `(3 + 0 - 0) % 3 = 0` (draw)
- both play scissors: `(3 + 2 - 2) % 3 = 0` (draw)
- etc

Then I looked at FHEVM more closely and saw that `modulo` isn't supported (yet). So I had to find another way.

Claude suggested using Lookup Tables (LUTs) which I hadn't thought of. Since there are only two inputs, a two-dimensional table is easy enough and doable in Solidity. Using the same representation as above, here's how the LUT looks like:

```
p1  | 0 1 2
----+-----
p2  |
0   | 0 1 2
1   | 1 0 2
2   | 2 1 0
```

If I were to do this in Solidity, this would be a very cheap way to get the result (but not as cheap as just `MOD` which is like 5 gas). Just look up `winner[p1][p2]` and you get the winner. Using FHEVM I'm playing with encrypted values so I also needed to encrypt the table:

```solidity
// pseudo-code
euint8 ZERO = FHE.euint8(0);
euint8 ONE = FHE.euint8(1);
euint8 TWO = FHE.euint8(2);

euint8[][] winner = [
    [ZERO, ONE, TWO],
    [ONE, ZERO, TWO],
    [TWO, ONE, ZERO]
];
```

All good here, but when playing the actual game, I'd need to get the value of `winner[player1Move][player2Move]` and return it. It fails because I can't pass an `euint8` to an array index, it needs to be a `uint256`. Dead end.

This is where I stopped fumbling around and went the naive way using just dumb if/else statements, which are made through `FHE.select` (I guess for the same reason?).


### Player Moves

Because it is a two-player game, obviously it needs two actions. Both players need to call the `submitMove` function which does the following:

- Verifies the validity proof
- Verifies the move is valid (0, 1, or 2)
- Stores the move in the contract

Honestly there are many other errors and edge cases I didn't consider. For example what happens if the second player never submits their move? The game would never end.

Anyway, I thought this was a simple starting point to learn how FHEVM works and to learn how error handling works. Looking at a simpler solidity example, I could just revert on a simple `if (move < 0)` but on FHEVM this won't make the transaction fail at all. So I read on [Zama's Error Handling](https://docs.zama.org/protocol/solidity-guides/smart-contract/logics/error_handling) and implemented an event that fires when errors change.

I did also consider some idempotency and integrity, for example a player can't submit twice, can't keep playing after the game ends, and other situations. But these errors are handled by the EVM so the contract just reverts when they happen.

#### Solo player version

I tried to make the solo version as close to the two-player version. Actually, I just made the core stuff (ex. `FHE.randEuint8(2)` and some other changes) and Claude did the rest. Thanks, Claude!

### Winning

As described above, winning is just a bunch of `FHE.selects` that decide:

- Whether there's a draw
- Whether p1 wins or loses

Then it increments the score count on p1 or p2 depending on whether p1 won or lost. Just add an encrypted `one` to the encrypted `score`.

As for the flow of the game, initially I thought of a two-function process like:

- Both players call `submitMove`
- Any of them call `determineGameWinner` which determines the winner

But when coding the solo version, which can determine the winner immediately, I realized I could do the same on the two-player game. It cost me an ugly `player.submitted` bool flag that gets reset after each round, but hey it works.

Also decided to just use a nested `struct` for `Game`. Naively I thought of doing `FHE.allowThis` on the whole struct but that obviously didn't work since there are cleartext values and bools there. It gets verbose real quick, but needs to be done.

## Triaging issues

I like strongly typed languages because they really don't let you do invalid stuff as you go along. So as long as the contract compiled, I could know that the FHEVM usage was syntactically correct.

The same can't be said for semantic correctness, though. This is a great reason why I would introduce fuzzy tests before considering this a semantically correct game.

### Debugging things that went wrong

- Decryption failed with "SenderNotAllowed" error if I forgot to call `FHE.allow()` after updating a score or move.
- Everything seemed to go well but indeed it didn't. This is because of the error code not being set, again the contract executes normally and doesn't revert so I used the same pattern as on the Zama documentation by setting `setLastError`.
- Tried to decrypt a euint8 handle using `FhevmType.euint32` which errored with something like "Wrong encrypted type". This was easy to find and fix.

## What would I do if I had more time

To be fair, I had a lot of time and a lot of fun. I tried to timebox it instead of getting pulled into the FHEVM rabbit hole.

So here's what I would (or will) do:

- Consider a few more edge cases like ending the game if one of the players stops playing, etc
- Improve the test suite with more of these edge-cases, and fuzzed results (ex. using randomized inputs and calculating the result in typescript, then compare with the result on-chsin)
- Write an actual frontend for this because it's honestly a funny game and frontend exercise (vite + WASM magic words love me).
- Make this contract mint an NFT for the winner or something involving calling or being called by other contracts
- Make this a CLI game because CLI games are cool

## Notes on AI

I used Claude very extensively throughout the project. The `context7` MCP was magnificent even though it filled the context window a bit too aggressively.

However I think we can breathe for now. AI dominance is still a bit behind.

Things it did very well:
- Writing and updating tests, specially when I changed something in the contract and just told it "go fix the test now". This made the whole exercise much more fun and creative
- Making me more lazy like "hah no way I'm gonna calculate the look-up table by myself, Claude do it for me please"
- Practically coded the solo version of the game using just the changes I told it
- Helped me review the submission at the end like "did I actually build what was asked" 😅

This it didn't do very well:
- Somehow it kept failing at understanding the game. It would do things like "all players default to 0 (rock), then player1 plays next, then player2 plays, then the winner is calculated", but I guess only a human can see that player2 could just repeatedly play 1 (paper) and win
- Context was sometimes completely ignored and it would do things like using if/else on encrypted values, and then correcting itself with the dumbest, most over-engineered things you can imagine
- Honestly it just does too much. Tries to "one-shot" stuff when it is asked to do a very simple, scoped task.