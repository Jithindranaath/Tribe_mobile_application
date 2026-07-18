use anchor_lang::prelude::*;

declare_id!("8Yc8JQutXw9rkS1VSYdGEkChGYJhkJKuw64v1CmdN5H8");

#[program]
pub mod tribe {
    use super::*;

    /// Create a new FanAccount when a fan joins a tribe.
    /// Standing is initialized to 100, titles to 0.
    pub fn create_fan_account(ctx: Context<CreateFanAccount>) -> Result<()> {
        let fan_account = &mut ctx.accounts.fan_account;
        fan_account.authority = ctx.accounts.authority.key();
        fan_account.tribe = ctx.accounts.tribe.key();
        fan_account.standing = 100;
        fan_account.titles = 0;
        fan_account.joined_slot = Clock::get()?.slot;
        fan_account.reads_correct = 0;
        fan_account.reads_total = 0;
        fan_account.bump = ctx.bumps.fan_account;

        // Increment tribe member count
        let tribe_account = &mut ctx.accounts.tribe;
        tribe_account.member_count = tribe_account.member_count.checked_add(1).unwrap();

        Ok(())
    }

    /// Initialize a new TribeAccount (admin only for hackathon).
    pub fn create_tribe(
        ctx: Context<CreateTribe>,
        macro_id: u16,
        region_id: u32,
    ) -> Result<()> {
        let tribe_account = &mut ctx.accounts.tribe_account;
        tribe_account.macro_id = macro_id;
        tribe_account.region_id = region_id;
        tribe_account.member_count = 0;
        tribe_account.aggregate_standing = 0;
        tribe_account.flame = 0;
        tribe_account.rank = 0;
        tribe_account.bump = ctx.bumps.tribe_account;
        Ok(())
    }

    /// Settle resolved Reads: create ReadRecord and update FanAccount standing.
    pub fn settle_read(
        ctx: Context<SettleRead>,
        fixture_id: u64,
        read_seq: u64,
        read_type: u8,
        predicted: u8,
        resolved: u8,
        txline_seq: u64,
        correct: bool,
        standing_delta: i64,
    ) -> Result<()> {
        let read_record = &mut ctx.accounts.read_record;
        read_record.fan = ctx.accounts.fan_account.key();
        read_record.fixture_id = fixture_id;
        read_record.read_type = read_type;
        read_record.predicted = predicted;
        read_record.resolved = resolved;
        read_record.txline_seq = txline_seq;
        read_record.correct = correct;
        read_record.standing_delta = standing_delta;
        read_record.resolved_slot = Clock::get()?.slot;
        read_record.bump = ctx.bumps.read_record;

        // Update FanAccount
        let fan_account = &mut ctx.accounts.fan_account;
        fan_account.standing = ((fan_account.standing as i64) + standing_delta) as u64;
        fan_account.reads_total = fan_account.reads_total.checked_add(1).unwrap();
        if correct {
            fan_account.reads_correct = fan_account.reads_correct.checked_add(1).unwrap();
        }

        Ok(())
    }
}

// ============================================================
// Account structures
// ============================================================

/// Fan identity — PDA seeds: ["fan", authority_pubkey]
#[account]
pub struct FanAccount {
    pub authority: Pubkey,      // 32 bytes - embedded wallet owner
    pub tribe: Pubkey,          // 32 bytes - current SubTribe PDA
    pub standing: u64,          // 8 bytes - soulbound reputation
    pub titles: u8,             // 1 byte - bitmask (Seer|Chronicler|Kindler|Keeper)
    pub joined_slot: u64,       // 8 bytes - slot when created
    pub reads_correct: u32,     // 4 bytes - resolved correctly
    pub reads_total: u32,       // 4 bytes - all resolved Reads
    pub bump: u8,               // 1 byte - PDA bump seed
}
// Total: 90 bytes

/// Sub-tribe — PDA seeds: ["tribe", macro_id.to_le_bytes(), region_id.to_le_bytes()]
#[account]
pub struct TribeAccount {
    pub macro_id: u16,          // 2 bytes - country code
    pub region_id: u32,         // 4 bytes - geographic sub-tribe identifier
    pub member_count: u32,      // 4 bytes - current members
    pub aggregate_standing: u64, // 8 bytes - sum of all member standing
    pub flame: u64,             // 8 bytes - collective treasury/morale
    pub rank: u32,              // 4 bytes - cached rank within macro_tribe
    pub bump: u8,               // 1 byte - PDA bump seed
}
// Total: 33 bytes

/// Resolved Read record — PDA seeds: ["read", fan_pubkey, fixture_id, read_seq]
#[account]
pub struct ReadRecord {
    pub fan: Pubkey,            // 32 bytes - fan who made the Read
    pub fixture_id: u64,        // 8 bytes - TxLINE fixtureId
    pub read_type: u8,          // 1 byte - moment/momentum/instinct
    pub predicted: u8,          // 1 byte - fan's prediction (encoded)
    pub resolved: u8,           // 1 byte - actual outcome (encoded)
    pub txline_seq: u64,        // 8 bytes - TxLINE event seq (audit trail)
    pub correct: bool,          // 1 byte - whether prediction matched outcome
    pub standing_delta: i64,    // 8 bytes - signed change to Standing
    pub resolved_slot: u64,     // 8 bytes - slot when resolved
    pub bump: u8,               // 1 byte - PDA bump seed
}
// Total: 69 bytes

// ============================================================
// Instruction contexts
// ============================================================

#[derive(Accounts)]
pub struct CreateFanAccount<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 90,
        seeds = [b"fan", authority.key().as_ref()],
        bump,
    )]
    pub fan_account: Account<'info, FanAccount>,

    #[account(mut)]
    pub tribe: Account<'info, TribeAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(macro_id: u16, region_id: u32)]
pub struct CreateTribe<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 33,
        seeds = [b"tribe", macro_id.to_le_bytes().as_ref(), region_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub tribe_account: Account<'info, TribeAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(fixture_id: u64, read_seq: u64)]
pub struct SettleRead<'info> {
    #[account(
        init,
        payer = settler,
        space = 8 + 69,
        seeds = [
            b"read",
            fan_account.key().as_ref(),
            fixture_id.to_le_bytes().as_ref(),
            read_seq.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub read_record: Account<'info, ReadRecord>,

    #[account(mut)]
    pub fan_account: Account<'info, FanAccount>,

    #[account(mut)]
    pub settler: Signer<'info>,

    pub system_program: Program<'info, System>,
}
