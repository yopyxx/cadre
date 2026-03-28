const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');
const http = require('http');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// 조건 역할들 중 하나라도 있으면 대상 역할 지급
const SOURCE_ROLE_IDS = [
  '1486229581190004753',
  '1486229581190004754',
  '1486229581584142437',
  '1486229581190004755'
];

// 지급할 역할
const TARGET_ROLE_ID = '1486229581584142436';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

// 슬래시 명령어
const commands = [
  new SlashCommandBuilder()
    .setName('전체지급')
    .setDescription('조건 충족 유저 전체에게 역할 지급')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON()
];

// 슬래시 명령어 등록
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log('슬래시 명령어 등록 완료');
}

// 조건 역할 중 하나라도 있는지 확인
function hasAnySourceRole(member) {
  if (!member || !member.roles) return false;
  return SOURCE_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

// 대상 역할 지급
async function addTargetRole(member) {
  if (!member || !member.user || member.user.bot) return false;

  const hasSource = hasAnySourceRole(member);
  const alreadyHasTarget = member.roles.cache.has(TARGET_ROLE_ID);

  if (hasSource && !alreadyHasTarget) {
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

  for (const [, member] of guild.members.cache) {
    try {
      const granted = await addTargetRole(member);
      if (granted) success++;
    } catch (error) {
      fail++;
      console.error(`역할 지급 실패: ${member.user?.tag || member.id}`, error);
    }
  }

  await interaction.editReply({
    content: `✅ 전체 지급 완료\n지급: ${success}명\n실패: ${fail}명`
  });
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
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ 관리자만 사용 가능합니다.',
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

// 역할 변경 시 자동 지급
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    const hadSource = hasAnySourceRole(oldMember);
    const hasSource = hasAnySourceRole(newMember);
    const hasTarget = newMember.roles.cache.has(TARGET_ROLE_ID);

    if ((!hadSource && hasSource) || (hasSource && !hasTarget)) {
      await newMember.roles.add(TARGET_ROLE_ID);
    }
  } catch (error) {
    console.error(`GuildMemberUpdate 역할 지급 실패: ${newMember.user?.tag || newMember.id}`, error);
  }
});

// 새로 들어온 유저도 조건 충족 시 자동 지급
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await addTargetRole(member);
  } catch (error) {
    console.error(`GuildMemberAdd 역할 지급 실패: ${member.user?.tag || member.id}`, error);
  }
});

// 간단한 웹서버
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('OK');
}).listen(process.env.PORT || 3000, () => {
  console.log(`웹서버 실행 중`);
});

client.login(TOKEN);
