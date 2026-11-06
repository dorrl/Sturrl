# Sturrl

문제를 공유하고 함께 해결하는 커뮤니티 서비스의 초기 풀스택 프로젝트입니다.

## 기술 스택

- Frontend: React 19, TypeScript, Vite
- Backend: Express 5
- Development: Express + Vite middleware mode + HMR
- Production: Express static hosting

## 실행

Node.js 20.19+ 또는 22.12+ 환경을 권장합니다.

```bash
npm install
npm run dev
```

기본 주소는 http://localhost:3000 입니다. 개발 모드에서는 Express가 API와 Vite 개발 미들웨어를 같은 포트에서 제공합니다.

## 빌드 및 운영

```bash
npm run build
npm start
```

- `npm run build`: 프런트엔드(`dist/`)와 서버(`dist-server/`)를 모두 빌드합니다.
- `npm start`: 빌드된 Express 서버를 실행하고 프런트엔드 정적 파일을 제공합니다.
- `PORT`: 서버 포트를 변경할 수 있습니다. 기본값은 3000입니다.

## API

- `GET /server/health`: 서버 상태 확인
- `GET /server/problems`: 문제 목록 조회
- `POST /server/problems`: 문제 등록

문제 데이터는 현재 서버 메모리에 저장되는 개발용 초기 구현입니다. 서버를 재시작하면 등록한 데이터가 초기화됩니다. 실제 서비스 운영 전에는 데이터베이스, 사용자 인증, 권한 및 입력 검증을 추가해야 합니다.
