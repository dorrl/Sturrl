# Sturrl

로그인 없이 문제를 공유하고, 정답을 맞히면 암호화된 해설을 열람하는 학습 커뮤니티입니다.

## 기술 스택
- React 19 + TypeScript + Vite
- Express 5 API
- Argon2id 관리 암호 해싱
- JSON 파일 기반 영속 저장소

## 실행
```bash
npm install
npm run dev
```
기본 주소: http://localhost:3000

## 빌드 및 운영
```bash
npm run build
npm start
```
- `npm run build`: React/Vite 프런트엔드와 Express 서버를 모두 빌드합니다.
- `npm start`: 빌드된 Express 서버로 정적 화면과 API를 함께 제공합니다.
- `PORT`: 서버 포트 (기본 3000)
- `ANSWER_PEPPER`: 정답 검증 및 해설 키 파생에 사용하는 서버 비밀값. 운영 환경에서는 반드시 충분히 긴 무작위 값으로 설정하고, 변경하거나 분실하면 기존 문제의 정답 검증/해설 복호화가 불가능해집니다.
- `MASTER_PASSWORD_HASH`: 모든 문제를 수정·삭제할 수 있는 운영자 마스터 암호의 Argon2id PHC 해시. 평문 암호가 아닌 해시만 환경 변수에 설정하세요.

## 문제 사진
- 문제마다 사진을 최대 5장까지 첨부할 수 있습니다.
- 원본 사진은 장당 100MB 미만이어야 하며, 브라우저에서 긴 변 최대 1920px의 WebP 이미지로 자동 압축한 뒤 저장합니다.
- 압축된 사진은 장당 약 3.15MB 이하로 제한되며, 목록에는 작은 썸네일, 상세 화면에는 사진 갤러리로 표시됩니다.
- 사진이 없는 기존 문제 데이터도 그대로 호환됩니다.

## 문제 분류
- 과목: 국어, 영어, 수학, 사회, 과학, 한국사
- 학년: 중1, 중2, 중3, 고1, 고2, 고3, 대학생
- 난이도: 1~5

## 문제 관리 암호
문제 등록 시 8자 이상의 관리 암호를 설정합니다. 서버는 암호 원문을 저장하지 않고 Argon2id로 해싱한 결과만 저장합니다. 문제별 관리 암호 또는 운영자 마스터 암호가 일치하면 문제를 수정·삭제할 수 있습니다. 마스터 암호는 `MASTER_PASSWORD_HASH` 환경 변수에 Argon2id PHC 해시로 저장하며, 개별 문제 데이터나 공개 API에는 노출되지 않습니다.

마스터 암호 해시는 프로젝트 의존성을 설치한 환경에서 다음처럼 생성할 수 있습니다.
```bash
node --input-type=module -e "import { hash } from '@node-rs/argon2'; console.log(await hash(process.argv[1]))" "원하는-마스터-암호"
```
출력된 해시를 배포 환경의 `MASTER_PASSWORD_HASH`에 설정하고 평문 암호는 환경 변수나 저장소에 넣지 마세요.

## API
- `GET /server/health`
- `GET /server/problems` — `subject`, `grade`, `difficulty`는 반복 쿼리 파라미터로 복수 선택(OR) 가능하며, 분류 간에는 AND로 적용됩니다. `sort`, `q`도 지원합니다.
- `POST /server/problems` — 문제, 정답, 해설, 관리 암호 및 선택 사진(최대 5장) 등록
- `GET /server/problems/:id` — 문제 상세 및 조회수 증가
- `POST /server/problems/:id/answer` — 정답 검증 후 맞으면 해설 반환
- `PUT /server/problems/:id` — `managementPassword` 검증 후 문제 수정(사진 포함)
- `DELETE /server/problems/:id` — JSON body의 `managementPassword` 검증 후 삭제

## 보안과 통계 메모
관리 암호는 Argon2id(메모리 19 MiB, 반복 2회, 병렬도 1)로 해싱하며, 각 암호의 salt는 라이브러리가 무작위 생성해 PHC 해시 문자열에 포함합니다. 암호 원문은 파일에 저장하지 않습니다. 정답 문자열도 평문으로 저장하지 않습니다. 서버는 문제별 salt와 `ANSWER_PEPPER`를 사용해 scrypt 키를 파생하고, 독립된 HMAC 검증값을 비교합니다. 해설은 파생 키로 AES-256-GCM 암호화해 저장하며 정답 검증이 성공한 요청에만 복호화 결과를 반환합니다. 정답 제출 API에는 IP 기준 5분 12회 제한을 둡니다.

이 구조는 데이터 파일이 유출되었을 때 평문 해설을 바로 읽지 못하게 하는 저장 시 암호화입니다. 서버가 정답을 검증하고 해설을 복호화하므로 서버 운영자나 서버 자체에 대한 종단간 암호화는 아닙니다. 짧고 흔한 정답은 추측 공격에 취약할 수 있으므로 출제자는 가능한 한 구체적인 정답 표현을 사용해야 합니다.

로그인 없이 브라우저별 익명 HttpOnly 쿠키로 고유 풀이자를 추정합니다. 쿠키 삭제, 시크릿 모드, 다른 기기 사용 등으로 고유 풀이자 수는 근사치이며 인증된 사용자 통계가 아닙니다. 정답 제출 횟수는 정답을 맞힌 전체 제출 횟수입니다.

기존 문제 데이터에 개별 관리 암호가 없더라도 `MASTER_PASSWORD_HASH`가 설정되어 있으면 마스터 암호로 수정·삭제할 수 있습니다. 문제 데이터는 저장소 루트의 `data/problems.json`에 저장됩니다. 운영 배포 시 이 파일을 영속 볼륨에 보관하고 `ANSWER_PEPPER`를 안전하게 백업하세요.
