# mock superpowers 데모 녹화와 README 갱신

작은 변경. main 브랜치에서 작업한다.

## 의도

0.8.0(세로 타임라인, SMALL/PROJECT 배지, 단계별 소요 시간)이 실제로 움직이는 모습을 README 데모로 보여준다. claude mods(이 pane)가 superpowers 흐름 전체를 따라가는지 확인하는 테스트도 겸한다.

## 목표

- 새 Claude Code 세션에서 mock 기능 "알림 설정 페이지"(이메일/푸시 on·off, 조용한 시간대)를 superpowers 흐름 그대로 진행한다: brainstorm → spec → plan → execute → review → finish
- plan은 task 10개이고, 각 task를 subagent(`Implement Task N: …`)가 처리한다. review subagent도 돈다
- task 하나는 약 5초가 걸린다(`sleep 5` 수준)
- 끝나면 후속 작업 3개를 TaskCreate로 남긴다: 다이제스트 메일, 채널별 기본값, 감사 로그
- 전체를 `screencapture`로 녹화하고 `ffmpeg`로 gif를 만든다. 마지막 화면은 png로 저장한다
- README를 현재 기능에 맞게 고치고 gif와 png를 교체한다

## 비목표 / 하지 말 것

- 저장소 코드(`hooks/`, `types/`)는 수정하지 않는다. mock은 실제 코드를 만들지 않는다
- mock의 spec, plan, ledger가 이 저장소에 남으면 안 된다

## 방식 (고려한 것)

- **A. 새 세션 띄워 녹화 (선택)**: `osascript`로 iTerm 창을 열고 scratchpad의 mock 폴더에서 `claude`를 auto mode로 실행한다. pane이 빈 상태에서 시작하므로 timeline이 처음부터 깨끗하게 찍히고, 이 대화는 화면에 나오지 않는다
- B. 이 세션에서 이어서 진행: 지금의 brainstorm 상태와 이력이 섞인다. 탈락
- C. 프롬프트를 사용자가 직접 붙여넣기: A와 결과는 같고 손이 더 간다. 탈락

## 결정된 것

- mock 폴더: scratchpad 아래 `mock/`, `git init`. plan 감지 정규식이 경로의 `/docs/superpowers/plans/`만 보므로(`hooks/plan.ts:19`) 저장소 밖에서도 진행률이 잡힌다
- 플러그인은 user scope로 켜져 있다(0.8.0). 새 폴더에서도 pane이 뜬다
- 녹화: iTerm 창 영역을 `screencapture -v -R`로 찍는다. gif는 이전 데모처럼 빠르게 돌려 약 30~40초, 10fps, 가로 1200px, 10MB 안쪽으로 만든다

## 빌더에게 맡김 (내 판단)

- mock 세션에 줄 프롬프트 문구: "질문하지 말고 스스로 답하며 진행, 크기는 a project, 각 subagent는 sleep 5 후 ledger에 기록, finish에서는 브랜치 유지"
- 폴더 trust 다이얼로그와 첫 프롬프트를 처리하는 방법(osascript 키 입력 등)
- iTerm 창 크기와 위치, 녹화 영역 좌표, 속도 배율
- README 문구: 0.8.0 기준으로 사실과 다른 부분만 고친다(예: 스크린샷 속 `모두 완료` → 현재 `completed`)
