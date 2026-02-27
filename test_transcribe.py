import urllib.request
import urllib.parse
import json
import http.cookiejar

# Setup cookie jar
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

# 1. Login
data = json.dumps({"email": "admin@example.com", "password": "admin"}).encode("utf-8")
req = urllib.request.Request("http://localhost:5000/api/auth/login", data=data)
req.add_header('Content-Type', 'application/json')
try:
    resp = opener.open(req)
    print("Login successful")
except urllib.error.HTTPError as e:
    print("Login failed:", e.code, e.read().decode())

# 2. Get CSRF token
csrf_token = ""
for cookie in cj:
    if cookie.name == 'csrf_token':
        csrf_token = cookie.value

# 3. Transcribe
boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
body = (
    f"--{boundary}\r\n"
    f"Content-Disposition: form-data; name=\"file\"; filename=\"test_audio.webm\"\r\n"
    f"Content-Type: audio/webm\r\n\r\n"
    f"dummy_data\r\n"
    f"--{boundary}--\r\n"
).encode('utf-8')

req2 = urllib.request.Request("http://localhost:5000/api/transcribe", data=body)
req2.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
if csrf_token:
    req2.add_header('X-CSRF-Token', csrf_token)

try:
    resp2 = opener.open(req2)
    print("Transcribe Success:", resp2.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(f"Transcribe HTTPError: {e.code}")
    print(e.read().decode('utf-8'))
except Exception as e:
    print("Transcribe Other error:", e)
