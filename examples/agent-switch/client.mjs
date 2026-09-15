export function createClient({ send, refresh, maxRetries = 1 }) {
  return async function request(path) {
    let response = await send(path);
    for (let attempt = 0; response.status === 401 && attempt < maxRetries; attempt++) {
      await refresh();
      response = await send(path);
    }
    return response;
  };
}
