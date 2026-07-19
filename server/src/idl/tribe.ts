/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/tribe.json`.
 */
export type Tribe = {
  "address": "8Yc8JQutXw9rkS1VSYdGEkChGYJhkJKuw64v1CmdN5H8",
  "metadata": {
    "name": "tribe",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "TRIBE — On-chain fan reputation, tribal identity, and soulbound Standing"
  },
  "instructions": [
    {
      "name": "createFanAccount",
      "docs": [
        "Create a new FanAccount when a fan joins a tribe.",
        "Standing is initialized to 100, titles to 0."
      ],
      "discriminator": [
        212,
        15,
        136,
        166,
        74,
        162,
        79,
        138
      ],
      "accounts": [
        {
          "name": "fanAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "tribe",
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "Does not need to sign — the server creates the account on the fan's behalf",
            "(silent wallet architecture; the fan's private key is never held server-side)."
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createTribe",
      "docs": [
        "Initialize a new TribeAccount (admin only for hackathon)."
      ],
      "discriminator": [
        26,
        137,
        21,
        62,
        21,
        228,
        127,
        43
      ],
      "accounts": [
        {
          "name": "tribeAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  105,
                  98,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "macroId"
              },
              {
                "kind": "arg",
                "path": "regionId"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "macroId",
          "type": "u16"
        },
        {
          "name": "regionId",
          "type": "u32"
        }
      ]
    },
    {
      "name": "settleRead",
      "docs": [
        "Settle resolved Reads: create ReadRecord and update FanAccount standing."
      ],
      "discriminator": [
        43,
        98,
        139,
        223,
        53,
        64,
        114,
        86
      ],
      "accounts": [
        {
          "name": "readRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  97,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fanAccount"
              },
              {
                "kind": "arg",
                "path": "fixtureId"
              },
              {
                "kind": "arg",
                "path": "readSeq"
              }
            ]
          }
        },
        {
          "name": "fanAccount",
          "writable": true
        },
        {
          "name": "tribe",
          "writable": true
        },
        {
          "name": "settler",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "fixtureId",
          "type": "u64"
        },
        {
          "name": "readSeq",
          "type": "u64"
        },
        {
          "name": "readType",
          "type": "u8"
        },
        {
          "name": "predicted",
          "type": "u8"
        },
        {
          "name": "resolved",
          "type": "u8"
        },
        {
          "name": "txlineSeq",
          "type": "u64"
        },
        {
          "name": "correct",
          "type": "bool"
        },
        {
          "name": "standingDelta",
          "type": "i64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "fanAccount",
      "discriminator": [
        121,
        23,
        32,
        50,
        97,
        66,
        56,
        73
      ]
    },
    {
      "name": "readRecord",
      "discriminator": [
        34,
        94,
        56,
        215,
        217,
        137,
        14,
        8
      ]
    },
    {
      "name": "tribeAccount",
      "discriminator": [
        175,
        60,
        174,
        47,
        7,
        35,
        216,
        27
      ]
    }
  ],
  "types": [
    {
      "name": "fanAccount",
      "docs": [
        "Fan identity — PDA seeds: [\"fan\", authority_pubkey]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "tribe",
            "type": "pubkey"
          },
          {
            "name": "standing",
            "type": "u64"
          },
          {
            "name": "titles",
            "type": "u8"
          },
          {
            "name": "joinedSlot",
            "type": "u64"
          },
          {
            "name": "readsCorrect",
            "type": "u32"
          },
          {
            "name": "readsTotal",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "readRecord",
      "docs": [
        "Resolved Read record — PDA seeds: [\"read\", fan_pubkey, fixture_id, read_seq]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fan",
            "type": "pubkey"
          },
          {
            "name": "fixtureId",
            "type": "u64"
          },
          {
            "name": "readType",
            "type": "u8"
          },
          {
            "name": "predicted",
            "type": "u8"
          },
          {
            "name": "resolved",
            "type": "u8"
          },
          {
            "name": "txlineSeq",
            "type": "u64"
          },
          {
            "name": "correct",
            "type": "bool"
          },
          {
            "name": "standingDelta",
            "type": "i64"
          },
          {
            "name": "resolvedSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tribeAccount",
      "docs": [
        "Sub-tribe — PDA seeds: [\"tribe\", macro_id.to_le_bytes(), region_id.to_le_bytes()]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "macroId",
            "type": "u16"
          },
          {
            "name": "regionId",
            "type": "u32"
          },
          {
            "name": "memberCount",
            "type": "u32"
          },
          {
            "name": "aggregateStanding",
            "type": "u64"
          },
          {
            "name": "flame",
            "type": "u64"
          },
          {
            "name": "rank",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
