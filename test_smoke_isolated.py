"""Non-destructive smoke tests: isolated temporary SQLite database, never production."""
import os, tempfile
from pathlib import Path
_tmp = tempfile.TemporaryDirectory(prefix='smartpark_test_')
os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(_tmp.name) / 'test.db')
os.environ['SECRET_KEY'] = 'local-test-only-not-for-production-secret'
os.environ['BOOTSTRAP_ADMIN_PASSWORD'] = 'test-admin-password-unique-2026'
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)

def test_health():
    r=client.get('/api/health'); assert r.status_code==200; assert r.json()['status']=='ok'

def test_frontend():
    r=client.get('/'); assert r.status_code==200; assert 'html' in r.headers['content-type']

def test_protected_routes():
    for url in ['/api/me','/api/vehicles','/api/revenue','/api/monthly','/api/dashboard']:
        assert client.get(url).status_code == 401, url

def test_login():
    assert client.post('/api/auth/login',json={'username':'admin','password':'wrong'}).status_code==401
    r=client.post('/api/auth/login',json={'username':'admin','password':'test-admin-password-unique-2026'})
    assert r.status_code==200, r.text
    token=r.json()['access_token']
    headers={'Authorization':'Bearer '+token}
    for url in ['/api/me','/api/areas','/api/slots','/api/pricing','/api/vehicles','/api/monthly','/api/dashboard','/api/revenue']:
        rr=client.get(url,headers=headers)
        assert rr.status_code==200, (url,rr.status_code,rr.text[:300])
