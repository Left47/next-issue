import re, sys, json, concurrent.futures as cf, urllib.request, os, ssl
# Usage:  python3 mu_legacy_scan.py START END STEP > out.json     (scan a range)
#         python3 mu_legacy_scan.py list ID ID ID ... > out.json  (specific digital IDs)
# Looks up Marvel Unlimited digital comic IDs via share.marvel.com's undocumented
# "legacy" route. Returns {digital_id: {src, drn, title, ...} | null-on-network-error}.
# Be polite: 16 threads ran ~12-25 req/s without errors beyond occasional timeouts.
ca = os.environ.get("SSL_CERT_FILE")  # set if behind a TLS-inspecting proxy
ctx = ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()
op = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
def get(d):
    try:
        t = op.open(f"https://share.marvel.com/sharing/legacy/{d}/raw", timeout=25).read().decode("utf8","ignore")
    except Exception as e:
        return d, None
    src = re.search(r'"SourceId","value":"(\d+)"', t)
    drn = re.search(r'"UnisonPublicationContent","id":"(drn:src:marvel:unison::prod:[0-9a-f-]{36})"', t)
    iss = re.search(r'"issued":"([^"]+)"', t)
    title = re.search(r'"UnisonPublicationContent","id":"[^"]+","title":"([^"]*)"', t)
    num = re.search(r'"publicationNumber":([0-9.]+)', t)
    return d, dict(src=src and src.group(1), drn=drn and drn.group(1), issued=iss and iss.group(1), title=title and title.group(1), num=num and num.group(1))
if __name__ == "__main__":
    ids = [int(x) for x in sys.argv[2:]] if sys.argv[1]=="list" else range(int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]))
    out = {}
    with cf.ThreadPoolExecutor(16) as ex:
        for d, r in ex.map(get, ids):
            out[d] = r
    print(json.dumps(out))
