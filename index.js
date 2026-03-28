const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const http = require('http');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// ✅ 변경된 대상 역할
const SOURCE_ROLE_IDS = [
  '1486229581190004753',
  '1486229581190004754',
  '1486229581584142437'
];

// ✅ 변경된 지급 역할
const TARGET_ROLE_ID = '1486229581584142436';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

// 슬래시 명령어 등록
const commands = [
  new SlashCommandBuilder()
    .setName('전체지급')
    .setDescription('조건 충족 유저 전체에게 역할 지급')
    .setDefaultMemberPermissions(0)
    .toJSON()
];

// 명령어 등록
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log('슬래시 명령어 등록 완료');
}

// 역할 체크
function hasAnySourceRole(member) {
  return SOURCE_ROLE_IDS.some(id => member.roles.cache.has(id));
}

// 역할 지급
async function addTargetRole(member) {
  if (!member || member.user.bot) return;

  const hasSource = hasAnySourceRole(member);
  const alreadyHas = member.roles.cache.has(TARGET_ROLE_ID);

  if (hasSource && !alreadyHas) {
    await member.roles.add(TARGET_ROLE_ID);
    return true;
  }
  return false;
}

// 전체 지급
async function fullGrant(guild, interaction) {
  await guild.members.fetch();

  let success = 0;
  let fail = 0;

  const members = guild.members.cache;

  for (const [, member] of members) {
    try {
      const result = await addTargetRole(member);
      if (result) success++;
    } catch (e) {
      fail++;
    }
  }

  await interaction.editReply(
    `✅ 전체 지급 완료\n지급: ${success}명\n실패: ${fail}명`
  );
}

// 봇 준비
client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} 로그인 완료`);
  await registerCommands();
});

// 명령어 처리
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === '전체지급') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ 관리자만 사용 가능',
        ephemeral: true
      });
    }

    await interaction.reply({
      content: '⏳ 전체 지급 진행 중...',
      ephemeral: true
    });

    await fullGrant(interaction.guild, interaction);
  }
});

// 자동 지급
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const had = hasAnySourceRole(oldMember);
  const has = hasAnySourceRole(newMember);
  const hasTarget = newMember.roles.cache.has(TARGET_ROLE_ID);

  if ((!had && has) || (has && !hasTarget)) {
    try {
      await newMember.roles.add(TARGET_ROLE_ID);
    } catch {}
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  await addTargetRole(member);
});

// 웹서버
http.createServer((req, res) => {
  res.end('OK');
}).listen(process.env.PORT || 3000);

client.login(TOKEN);
