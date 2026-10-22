// 리뷰 봇 확인용 샘플이다. percent를 100으로 나누지 않아 할인액이 커진다.
export function discount(price, percent) {
  return price - price * percent;
}
