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

// 조건 역할들
const SOURCE_ROLE_IDS = [
  '1386716926528585855', // 부사관
  '1386716926528585857', // 장교
  '1484955943237193909'  // 인사행정단
];

// 자동 지급 역할
const TARGET_ROLE_ID = '1487030918794313758';

if (!TOKEN) {
  console.error('TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('CLIENT_ID 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

if (!GUILD_ID) {
  console.error('GUILD_ID 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

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
    .setDescription('조건에 맞는 모든 유저에게 역할을 지급 또는 제거합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
].map(command => command.toJSON());

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log('슬래시 명령어 등록 완료');
  } catch (error) {
    console.error('슬래시 명령어 등록 실패:', error);
  }
}

// 대상 역할 지급 조건 확인
function shouldHaveTargetRole(member) {
  return SOURCE_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

// 1명 동기화
async function syncMemberRole(member) {
  try {
    if (!member || !member.guild || member.user.bot) {
      return { added: false, removed: false, skipped: true };
    }

    const hasTargetRole = member.roles.cache.has(TARGET_ROLE_ID);
    const needsTargetRole = shouldHaveTargetRole(member);

    if (needsTargetRole && !hasTargetRole) {
      await member.roles.add(
        TARGET_ROLE_ID,
        '지정 역할(부사관/장교/인사행정단) 보유로 자동 지급'
      );
      console.log(`[지급] ${member.user.tag} (${member.id})`);
      return { added: true, removed: false, skipped: false };
    }

    if (!needsTargetRole && hasTargetRole) {
      await member.roles.remove(
        TARGET_ROLE_ID,
        '지정 역할(부사관/장교/인사행정단) 미보유로 자동 제거'
      );
      console.log(`[제거] ${member.user.tag} (${member.id})`);
      return { added: false, removed: true, skipped: false };
    }

    return { added: false, removed: false, skipped: true };
  } catch (error) {
    console.error(`[오류] ${member.user?.tag || member.id} 역할 동기화 실패:`, error);
    return { added: false, removed: false, skipped: true, error: true };
  }
}

// 전체 서버 동기화
async function syncAllGuildMembers(guild) {
  let addedCount = 0;
  let removedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    console.log(`[시작] ${guild.name} 전체 멤버 역할 동기화`);
    await guild.members.fetch();

    for (const member of guild.members.cache.values()) {
      const result = await syncMemberRole(member);

      if (result.added) addedCount++;
      else if (result.removed) removedCount++;
      else skippedCount++;

      if (result.error) errorCount++;
    }

    console.log(
      `[완료] ${guild.name} | 지급: ${addedCount}, 제거: ${removedCount}, 유지: ${skippedCount}, 오류: ${errorCount}`
    );

    return {
      addedCount,
      removedCount,
      skippedCount,
      errorCount
    };
  } catch (error) {
    console.error(`[오류] ${guild.name} 전체 동기화 실패:`, error);
    return {
      addedCount,
      removedCount,
      skippedCount,
      errorCount: errorCount + 1
    };
  }
}

// 준비 완료
client.once(Events.ClientReady, async readyClient => {
  console.log(`로그인 완료: ${readyClient.user.tag}`);

  await registerCommands();

  const guild = readyClient.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.error(`지정한 GUILD_ID(${GUILD_ID})의 서버를 찾을 수 없습니다.`);
    return;
  }

  await syncAllGuildMembers(guild);
});

// 새 멤버 입장
client.on(Events.GuildMemberAdd, async member => {
  if (member.guild.id !== GUILD_ID) return;
  if (member.user.bot) return;

  await syncMemberRole(member);
});

// 역할 변경 감지
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;
  if (newMember.user.bot) return;

  const oldHasAnySource = SOURCE_ROLE_IDS.some(roleId => oldMember.roles.cache.has(roleId));
  const newHasAnySource = SOURCE_ROLE_IDS.some(roleId => newMember.roles.cache.has(roleId));
  const oldHasTarget = oldMember.roles.cache.has(TARGET_ROLE_ID);
  const newHasTarget = newMember.roles.cache.has(TARGET_ROLE_ID);

  if (
    oldHasAnySource !== newHasAnySource ||
    oldHasTarget !== newHasTarget
  ) {
    await syncMemberRole(newMember);
  }
});

// 슬래시 명령어 처리
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== GUILD_ID) return;

  if (interaction.commandName === '전체지급') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: '이 명령어를 사용할 권한이 없습니다.',
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: '전체 역할 동기화를 진행 중입니다...',
      ephemeral: true
    });

    const guild = interaction.guild;
    const result = await syncAllGuildMembers(guild);

    await interaction.editReply({
      content:
        `전체 역할 동기화가 완료되었습니다.\n\n` +
        `지급: ${result.addedCount}명\n` +
        `제거: ${result.removedCount}명\n` +
        `유지: ${result.skippedCount}명\n` +
        `오류: ${result.errorCount}건`
    });
  }
});

// 에러 로그
client.on('error', error => {
  console.error('클라이언트 에러:', error);
});

process.on('unhandledRejection', error => {
  console.error('처리되지 않은 Promise 에러:', error);
});

process.on('uncaughtException', error => {
  console.error('처리되지 않은 예외:', error);
});

// Railway용 웹서버
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false }));
}).listen(PORT, () => {
  console.log(`웹서버 실행 중: ${PORT}`);
});

client.login(TOKEN);
