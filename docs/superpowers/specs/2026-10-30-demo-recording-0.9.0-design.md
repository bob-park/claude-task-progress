# 0.9.0 mock superpowers 데모 녹화와 README 갱신

작은 변경. main 브랜치, 이 세션에서 작업한다.

## 의도

0.9.0(단계마다 agent 유지, 최대 5줄과 `… N more`)이 superpowers 흐름 전체를 실제로 따라가는지 확인하는 claude mods 테스트이자, 그 모습을 README 데모로 쓴다.

## 목표

- mock 기능 "알림 설정 페이지"(이메일/푸시 on·off, 조용한 시간대)를 superpowers 흐름 그대로 진행한다: spec → plan → execute → review → finish
- plan은 task 10개, task마다 impl subagent(`Implement Task N: …`)가 처리한다. 작업 내용은 실제 구현처럼 이름 붙인다
- task 하나는 약 5초(`sleep 5`)
- 녹화는 직접 한다: `screencapture -v -V 300`(5분), ffmpeg로 gif 변환, 마지막 장면은 png
- README를 0.9.0 기준으로 고치고 gif/png를 교체한다

## 비목표 / 하지 말 것

- 저장소 코드(`hooks/`, `types/`)는 수정하지 않는다
- mock의 spec, plan, ledger, 소스는 저장소에 남기지 않는다(scratchpad `mock/`에만)

## 방식

- **A. 이 세션에서 실제 skill과 subagent로 진행 (선택)**: pane이 실제 transcript를 읽으므로 mods 테스트 목적에 맞다. 이 대화의 brainstorm 이력이 타임라인에 함께 찍힌다
- B. 새 iTerm 창에 별도 세션: "현재 세션" 요구와 어긋나서 탈락
- C. 가짜 transcript 주입: 실제 동작을 검증하지 못해서 탈락

## 결정된 것

- mock 폴더: scratchpad 아래 `mock/`, `git init`. plan 감지는 경로의 `/docs/superpowers/plans/`만 보므로 저장소 밖에서도 진행률이 잡힌다
- 녹화는 mock 흐름 시작 직전에 백그라운드로 켠다

## 빌더에게 맡김 (내 판단)

- 녹화 영역(터미널 창 좌표, `-R`), gif 속도 배율과 크기(이전처럼 약 1200px, 10MB 이하)
- review subagent 수, finish에서 브랜치 처리(mock이므로 유지)
- README 문구: 0.9.0 기준으로 사실과 다른 부분만 고친다
