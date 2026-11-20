---
version: alpha
name: "삼국지14 친애 편성기"
description: "장수 명부에서 친애 관계와 출진 역할을 확인하는 편성 화면"
colors:
  primary: "#2457A7"
  background: "#EDF1F7"
  surface: "#FFFFFF"
  text: "#172B45"
  selected: "#DFEAFC"
  warning: "#884514"
typography:
  display:
    fontFamily: "Noto Serif KR, Batang, AppleMyungjo, serif"
  body:
    fontFamily: "Noto Sans KR, Malgun Gothic, Apple SD Gothic Neo, system-ui, sans-serif"
rounded:
  md: "0.375rem"
  lg: "0.625rem"
spacing:
  page-max: "90rem"
components:
  button: {}
  select: {}
  table: {}
  relation: {}
  dialog: {}
---

# 삼국지14 친애 편성기 시각 기준

## Overview

한국어 플레이어가 게임 중 장수 명부를 살피고 함께 출진할 장수를 고르는 화면이다. 장수 행에서 연결 근거를 열면 선택 장수와 직접 연결된 상대가 강조된다. 관계 행의 화살표에는 CE 개인 친애 방향을 쓰고 기존 연계 등급은 글자 배지로 표시한다.

## Colors

`docs/styles.css`가 실행 토큰을 관리한다. 배경은 `--page`, 표면은 `--paper`, 글자는 `--ink`, 액션은 `--accent`, 선택은 `--selected`, 데이터 경고는 `--warning`으로 연결한다. 다크 테마에서도 대비와 의미를 유지하고, 경고와 선택에는 문구나 경계선을 함께 사용한다.

## Typography

큰 제목에 한글 명조, 조작부와 데이터에 고딕을 사용한다. 편성 인원·직접 관계 수·능력치에는 고정폭 숫자 표시를 적용한다. 대체 글꼴은 시스템에 있는 한글 글꼴을 이용한다.

## Layout

넓은 화면은 집단을 가로로 선택하고, 선택 집단은 화면 폭을 사용한다. 560px 이하에서는 집단 메뉴와 미편성 단축 버튼으로 전환한다. 입력을 마치면 명단을 한 줄로 접고, 비교·출진은 같은 결과 위치에서 연다. 한 페이지의 세로 스크롤을 기본으로 사용한다.

## Elevation & Depth

입력과 결과는 경계선으로 구분하고, 프리셋 메뉴와 상세 대화상자에는 그림자를 쓴다.

## Shapes

버튼과 선택 메뉴는 0.375rem, 주요 표면과 대화상자는 0.625rem 모서리를 적용한다.

## Components

주요 조작은 파란 버튼, 탐색과 정보는 경계선 버튼이나 텍스트 링크 형태다. 같은 이름의 조작은 동일한 버튼과 색을 사용한다. 상태 안내와 포커스는 `ui.js`와 공통 CSS를 이용한다. 친애 품질 경고는 각 관계 행 가까이에 표시한다.
