const {
  Client,
  GatewayIntentBits,
  Partials,
  Events
} = require('discord.js');
const http = require('http');

const TOKEN = process.env.TOKEN;

// 지급 조건 역할
const SOURCE_ROLE_IDS = [
  '1386716926528585855', // 부사관
  '1386716926528585857', // 장교
  '1484955943237193909'  // 인사행정단
];

// 자동 지급할 역할
const TARGET_ROLE_ID = '1487030918794313758';

if (!TOKEN) {
  console.error('TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

// 대상 역할을 받아야 하는지 확인
function shouldHaveTargetRole(member) {
  return SOURCE_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

// 대상 역할을 빼야 하는지 확인
function shouldRemoveTargetRole(member) {
  return !SOURCE_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

// 역할 지급/회수 처리
async function syncMemberRole(member) {
  try {
    const hasTargetRole = member.roles.cache.has(TARGET_ROLE_ID);
    const needsTargetRole = shouldHaveTargetRole(member);

    if (needsTargetRole && !hasTargetRole) {
      await member.roles.add(TARGET_ROLE_ID, '지정 역할(부사관/장교/인사행정단) 보유로 자동 지급');
      console.log(`[지급] ${member.user.tag} (${member.id}) -> ${TARGET_ROLE_ID}`);
      return;
    }

    if (!needsTargetRole && hasTargetRole) {
      await member.roles.remove(TARGET_ROLE_ID, '지정 역할(부사관/장교/인사행정단) 미보유로 자동 제거');
      console.log(`[제거] ${member.user.tag} (${member.id}) -> ${TARGET_ROLE_ID}`);
      return;
    }
  } catch (error) {
    console.error(`[오류] ${member.user?.tag || member.id} 역할 동기화 실패:`, error);
  }
}

// 봇 실행 시 전체 동기화
async function syncAllGuildMembers() {
  console.log('전체 멤버 역할 동기화 시작');

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch();

      for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;
        await syncMemberRole(member);
      }

      console.log(`[완료] 길드 ${guild.name} (${guild.id}) 동기화 완료`);
    } catch (error) {
      console.error(`[오류] 길드 ${guild.name} (${guild.id}) 동기화 실패:`, error);
    }
  }

  console.log('전체 멤버 역할 동기화 종료');
}

// 봇 준비 완료
client.once(Events.ClientReady, async readyClient => {
  console.log(`로그인 완료: ${readyClient.user.tag}`);
  await syncAllGuildMembers();
});

// 새 멤버 입장 시 처리
client.on(Events.GuildMemberAdd, async member => {
  if (member.user.bot) return;
  await syncMemberRole(member);
});

// 역할 변경 감지
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.user.bot) return;

  const oldHasAnySource = SOURCE_ROLE_IDS.some(roleId => oldMember.roles.cache.has(roleId));
  const newHasAnySource = SOURCE_ROLE_IDS.some(roleId => newMember.roles.cache.has(roleId));
  const oldHasTarget = oldMember.roles.cache.has(TARGET_ROLE_ID);
  const newHasTarget = newMember.roles.cache.has(TARGET_ROLE_ID);

  // 관련 변화가 있을 때만 실행
  if (
    oldHasAnySource !== newHasAnySource ||
    oldHasTarget !== newHasTarget
  ) {
    await syncMemberRole(newMember);
  }
});

// 에러 방지 로그
client.on('error', error => {
  console.error('클라이언트 에러:', error);
});

process.on('unhandledRejection', error => {
  console.error('처리되지 않은 Promise 에러:', error);
});

process.on('uncaughtException', error => {
  console.error('처리되지 않은 예외:', error);
});

// Railway용 간단한 웹서버
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
