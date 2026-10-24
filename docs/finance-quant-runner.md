# 기존 Quant 서버와 Bandal Finance 연결

Bandal Finance의 공개 파라미터 실험실과 기존 비공개 `Quant-v1.0` 실행기는 별개다.
기존 실행기는 Python/systemd에서 작동하고 Quant Companion API는 하나의 개인 PAPER
원장을 조회한다. 다중 사용자별 전략 편집이나 실매매 활성화 API를 제공하지 않는다.
따라서 이 연결은 **운영자가 지정한 원래 소유자 한 명에게만 읽기 전용**으로 제공한다.
기존 알고리즘 소스, 활성 파라미터, 계좌 키를 공개 저장소에 복사하지 않는다.

## 운영 설정

Sites 환경 변수에서 다음 값을 설정해야 한다. 값은 소스나 브라우저 코드에 넣지 않는다.

| 변수 | 의미 |
| --- | --- |
| `FINANCE_QUANT_RUNNER_URL` | 기존 Quant Companion API를 제공하는 고정 HTTPS origin. 경로, 포트, 사용자 정보, IP 주소, 내부 호스트는 지원하지 않는다. |
| `FINANCE_QUANT_RUNNER_OWNER` | 원래 소유자의 전체 Finance owner SHA-256 digest. `SHA256('finance:' + Sites의 신뢰된 사용자 ID)` 형식이며 이메일이나 브라우저 전달 ID를 사용하지 않는다. 실제 API 구현의 namespace와 일치해야 한다. |
| `FINANCE_CREDENTIAL_KEY` | 연결 토큰을 암호화하는 32바이트 AES-GCM 키. base64 또는 64자리 hex. 기존 브로커 연결과 같은 서버 vault를 사용한다. |

설정이 없으면 기존 Quant 연결은 `미연결` 상태다. 현재 운영 서버 주소·소유자 정보와
새 연결 코드가 제공되지 않았으므로 개발 과정에서 원래 서버에 연결하거나 실행을
변경하지 않았다.

## 연결 절차와 기기 교체 영향

1. 기존 Quant 서버에서 `python -m quant_api.cli pairing-code`로 10분 유효한 일회용
   8자리 코드를 만든다. 코드·토큰은 메일이나 저장소에 기록하지 않는다.
2. 지정된 소유자가 Bandal Finance에 로그인하고 기존 Quant 연결 화면에 코드를 입력한다.
3. **기존 Quant Companion 기기 연결과 푸시가 해제될 수 있음**을 확인해야 연결된다.
   원래 서버는 단일 활성 기기 모델이라 새 Finance 기기를 등록하면 다른 기기를 해제한다.
4. 서버가 `/api/v1/auth/pair`를 호출하고 access/refresh token을 AES-GCM으로 암호화해
   `finance_connections`의 소유자 전용 행에 저장한다. 브라우저에는 토큰을 반환하지 않는다.
5. 화면 조회 시 `/api/v1/dashboard`, `/api/v1/bot/status`만 호출한다. access token이
   만료되면 서버에서 `/api/v1/auth/refresh`를 호출한다. 현재 기존 API의 persistent
   refresh는 안정적인 토큰을 유지하고, 교체 토큰이 응답되면 CAS 저장한다.

## 제공 범위

- 개인 PAPER 총자산·수익률·자산 이력·운용 구분 비중과 트랙/안전 상태 조회.
- 설정된 소유자 외에는 서버 존재 여부나 저장된 연결 여부를 드러내지 않는다.
- API 응답을 필드별로 다시 구성해 토큰·오류 본문·알고리즘·개인 라벨이 전달되지 않게 한다.
- 브라우저가 임의 서버 URL이나 API 경로를 지정할 수 없고 redirect를 따라가지 않는다.
- 연결 해제는 Finance vault의 연결만 삭제한다. 원래 서버의 기기 해제는 기존 관리 절차로
  수행해야 한다. 이 화면은 주문, PAPER 제어, HALT 해제, 파라미터 변경을 하지 않는다.

## 검증 범위

`node --test tests/finance/runner.test.mjs`는 두 계정 접근 차단, URL 제한, 암호화 저장,
토큰 갱신, 오류·민감 필드 제거, 기기 교체 확인, 응답 크기 제한, 연결 해제를 검증한다.
기존 서버와의 실제 HTTPS 연결·페어링 및 실제 원장 조회는 운영 설정 후 별도 확인해야 한다.
