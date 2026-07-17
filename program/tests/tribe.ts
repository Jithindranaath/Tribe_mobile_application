import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Tribe } from '../target/types/tribe';

describe('tribe', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Tribe as Program<Tribe>;

  it('Creates a tribe account', async () => {
    // TODO: implement after deployment
  });

  it('Creates a fan account', async () => {
    // TODO: implement after deployment
  });

  it('Settles a read', async () => {
    // TODO: implement after deployment
  });
});
