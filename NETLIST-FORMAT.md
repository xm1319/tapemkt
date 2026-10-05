# TapeOut Netlist Binary Format — Reverse-Engineered Specification

> Reverse-engineered from the official TapeOut bundle and **verified against on-chain behaviour** on X Layer (OrderGuard processor `0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355`). All examples below were taped out and evaluated successfully on mainnet.

## Signal numbering

Signals are referenced by `u24` index:

| Range | Meaning |
|---|---|
| `0` | constant `0` |
| `1` | constant `1` |
| `2 .. 2+nIn-1` | circuit inputs (input `i` = signal `2+i`) |
| `2+nIn+i` | output of gate `i` (gates must be listed in topological order; a gate may only reference signals with a lower index than its own output — the contract reverts with `NAND: future signal` otherwise) |

The **last `nOut` signals** are the circuit outputs.

## Opcodes

### NAND — 7 bytes

```
0x00 | u24 a | u24 b
```

Output = `1` iff both inputs are `0` (classic NAND).

### LATCH — 4 bytes

```
0x01 | u24 d
```

State element (1-bit latch driven by signal `d`). Contract reports `nState` in `circuitInfo()`.

### REF — sub-circuit reference

```
0x02 | addr20 | u64 circuitId | u8 nIn | u8 nOut | nIn × u24 input signals
```

References another taped-out circuit by contract address + circuit id (circuit reuse/composition).

## Integer encoding

- `u24` / `u64`: **big-endian**, unsigned.

## Output buffering

The contract automatically appends **2 buffer NAND gates** (i.e. `NAND(x,x)` twice = identity) to each output pin at tape-out time. You do **not** add them yourself; `netlist(id)` returns your original bytes, buffering is internal.

## eval bit-packing

`eval(uint256 id, bytes inputs)`:

- `inputs`: input values packed bit-wise — **bit 0 = first input pin**, bit 1 = second, … (so for ≤8 inputs one byte suffices)
- returns `bytes`: output values packed the same way — bit 0 = first output pin

Example (Half Adder, 2 in / 2 out):

```
eval(4, 0x03)  # in0=1, in1=1
→ 0x02         # sum=0 (bit0), carry=1 (bit1)
```

## Worked example — Majority gate MAJ3 (12 NAND)

```
in: a=2, b=3, c=4          gates (output signal = 2+3+i):
NAND(a,b) → 5              i=0
NAND(a,c) → 6              i=1
NAND(b,c) → 7              i=2
NAND(5,5) → 8   # A = a&b
NAND(6,6) → 9   # B = a&c
NAND(7,7) → 10  # C = b&c
NAND(8,8) → 11  # ¬A
NAND(9,9) → 12  # ¬B
NAND(11,12)→ 13 # A|B
NAND(13,13)→ 14 # ¬(A|B)
NAND(10,10)→ 15 # ¬C
NAND(14,15)→ 16 # out = (A|B)|C = MAJ3
```

Truth table (all 8 combos verified on-chain, `eval(3, …)`):

```
000→0  001→0  010→0  011→1  100→0  101→1  110→1  111→1
```

## Fees (X Layer, measured)

| Item | Cost |
|---|---|
| `TAPEOUT_FEE` | 0.0013 OKB per tape-out |
| NAND transistor mint | 0.0001 OKB each |
| Protocol fee | 0.00066 OKB per mint batch |

Total example: MAJ3 (12 NAND) ≈ 0.0013 + 0.0012 + 0.00066 ≈ **0.0032 OKB**.
