/// 进程内 token 持有者：ApiClient 需要同步 tokenProvider，而 SecureStorage 是异步的。
class TokenHolder {
  String value = '';
}
