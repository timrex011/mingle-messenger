let refreshPromise;

function send(path, { token, method = 'GET', body, headers = {} } = {}, useToken = token) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const apiPath = path.startsWith('/api/') ? path : `/api${path}`;
  return fetch(apiPath, {
    method,
    credentials: 'include',
    headers: {
      ...(body === undefined || isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(useToken ? { Authorization: `Bearer ${useToken}` } : {}),
      ...headers
    },
    ...(body === undefined ? {} : { body: isFormData ? body : JSON.stringify(body) })
  });
}

async function readResponse(response) {
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Die Anfrage konnte nicht abgeschlossen werden.');
  return data;
}

export async function request(path, options = {}) {
  return readResponse(await authorizedResponse(path, options));
}

export async function requestBlob(path, options = {}) {
  const response = await authorizedResponse(path, options);
  if (!response.ok) {
    await readResponse(response);
  }
  return response.blob();
}

async function authorizedResponse(path, options) {
  let response = await send(path, options);
  if (response.status === 401 && options.token && path !== '/auth/refresh' && path !== '/auth/logout') {
    if (!refreshPromise) {
      refreshPromise = send('/auth/refresh', { method: 'POST' })
        .then(readResponse)
        .finally(() => { refreshPromise = undefined; });
    }
    try {
      const refreshed = await refreshPromise;
      options.onToken?.(refreshed.accessToken);
      response = await send(path, options, refreshed.accessToken);
    } catch {
      throw new Error('Sitzung abgelaufen. Bitte melde dich erneut an.');
    }
  }
  return response;
}
