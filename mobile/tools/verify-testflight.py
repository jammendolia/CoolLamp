"""GET-only verification of one already-uploaded iOS build. No secrets in output."""
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import jwt
import requests

BASE = 'https://api.appstoreconnect.apple.com'
BUILD = os.environ['BUILD_NUMBER']
MARKETING = json.loads(Path('package.json').read_text())['version']
result = {'uploaded': True, 'marketingVersion': MARKETING, 'buildNumber': BUILD,
          'processed': False, 'internalTestingAvailable': None}


def get(path, params):
    now = int(time.time())
    token = jwt.encode({'iss': os.environ['APP_STORE_CONNECT_ISSUER_ID'],
                        'iat': now, 'exp': now + 240, 'aud': 'appstoreconnect-v1'},
                       os.environ['APP_STORE_CONNECT_PRIVATE_KEY'], algorithm='ES256',
                       headers={'kid': os.environ['APP_STORE_CONNECT_KEY_IDENTIFIER'], 'typ': 'JWT'})
    response = requests.get(BASE + path, params=params,
                            headers={'Authorization': 'Bearer ' + token}, timeout=20,
                            allow_redirects=False)
    if response.status_code >= 400:
        try:
            codes = [re.sub(r'[^A-Za-z0-9._-]', '', str(item.get('code', '')))[:80]
                     for item in response.json().get('errors', [])[:8]]
        except Exception:
            codes = []
        result['verificationError'] = {
            'method': 'GET', 'endpoint': re.sub(r'/[0-9a-f-]{8,}(?=/|$)', '/{id}', path),
            'httpStatus': response.status_code, 'codes': codes}
    if response.status_code in (401, 403):
        raise PermissionError('Read-only Apple verification unavailable')
    response.raise_for_status()
    return response.json()


try:
    apps = get('/v1/apps', {'filter[bundleId]': 'com.coollamp.controller',
                           'fields[apps]': 'bundleId', 'limit': 2}).get('data', [])
    if len(apps) != 1 or apps[0]['attributes']['bundleId'] != 'com.coollamp.controller':
        raise ValueError('Exact app could not be verified')
    app_id = apps[0]['id']
    deadline = time.monotonic() + 720
    while time.monotonic() < deadline:
        data = get('/v1/builds', {
            'filter[app]': app_id, 'filter[version]': BUILD,
            'filter[preReleaseVersion.version]': MARKETING,
            'filter[preReleaseVersion.platform]': 'IOS',
            'include': 'preReleaseVersion,buildBetaDetail',
            'fields[builds]': 'version,expired,processingState,preReleaseVersion,buildBetaDetail',
            'fields[preReleaseVersions]': 'version,platform',
            'fields[buildBetaDetails]': 'internalBuildState,externalBuildState', 'limit': 2})
        builds = data.get('data', [])
        included = {(item['type'], item['id']): item for item in data.get('included', [])}
        if len(builds) == 1:
            build = builds[0]
            train_ref = build['relationships']['preReleaseVersion']['data']
            train = included.get((train_ref['type'], train_ref['id']), {}).get('attributes', {})
            if build['attributes']['version'] != BUILD or train.get('version') != MARKETING or train.get('platform') != 'IOS':
                raise ValueError('Apple returned a different build')
            attributes = build['attributes']
            result.update({'buildId': build['id'], 'processingState': attributes['processingState'],
                           'expired': attributes['expired']})
            detail_ref = build['relationships'].get('buildBetaDetail', {}).get('data')
            detail = included.get((detail_ref['type'], detail_ref['id']), {}).get('attributes', {}) if detail_ref else {}
            result['internalBuildState'] = detail.get('internalBuildState', 'UNAVAILABLE')
            if attributes['processingState'] in ('FAILED', 'INVALID'):
                result['terminalFailure'] = True
                break
            result['processed'] = attributes['processingState'] == 'VALID' and not attributes['expired']
            if result['processed']:
                assigned = get('/v1/builds/' + build['id'], {
                    'include': 'betaGroups', 'fields[builds]': 'version,betaGroups',
                    'fields[betaGroups]': 'isInternalGroup,hasAccessToAllBuilds', 'limit[betaGroups]': 50})
                exact = assigned['data']
                if exact['id'] != build['id'] or exact['attributes']['version'] != BUILD:
                    raise ValueError('Group association returned a different build')
                refs = exact['relationships']['betaGroups']['data']
                groups = {(item['type'], item['id']): item for item in assigned.get('included', [])}
                if any((item['type'], item['id']) not in groups for item in refs):
                    raise ValueError('Group association was incomplete')
                automatic = get('/v1/apps/' + app_id + '/betaGroups', {
                    'fields[betaGroups]': 'isInternalGroup,hasAccessToAllBuilds', 'limit': 200})
                assigned_count = sum(groups[(item['type'], item['id'])]['attributes'].get('isInternalGroup') is True for item in refs)
                automatic_count = sum(item['attributes'].get('isInternalGroup') is True and item['attributes'].get('hasAccessToAllBuilds') is True for item in automatic.get('data', []))
                result.update({'assignedInternalGroupCount': assigned_count, 'automaticInternalGroupCount': automatic_count})
                result['internalTestingAvailable'] = result['internalBuildState'] == 'IN_BETA_TESTING' and bool(assigned_count or automatic_count)
                if result['internalTestingAvailable'] or attributes['expired']:
                    break
                if result['internalBuildState'] in ('MISSING_EXPORT_COMPLIANCE', 'IN_EXPORT_COMPLIANCE_REVIEW', 'EXPIRED', 'PROCESSING_EXCEPTION'):
                    break
        time.sleep(30)
except PermissionError:
    result['verification'] = 'Apple read permission unavailable; upload is separate'
except Exception as error:
    result['verification'] = 'Read-only verification unavailable: ' + type(error).__name__
result['checkedAt'] = datetime.now(timezone.utc).isoformat()
Path('testflight-status.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
if result.get('terminalFailure'):
    raise SystemExit('Apple rejected processing of this exact build')
