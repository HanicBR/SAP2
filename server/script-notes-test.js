const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const player = await prisma.playerProfile.findFirst();
  console.log('player', player && player.steamId);
  if (!player) return;

  const note = await prisma.playerNote.create({
    data: {
      steamId: player.steamId,
      content: 'CLI test note',
      staffName: 'CLI',
    },
  });
  console.log('note', note.id);
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

