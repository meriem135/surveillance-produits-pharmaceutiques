import logging
import socket
from opensearchpy import OpenSearch
from app.core.config import settings

logger = logging.getLogger(__name__)


class IntelligenceService:
    def __init__(self):
        self.client = None
        try:
            host = settings.OPENSEARCH_URL.replace("https://", "").replace("http://", "").split(":")[0]
            # Quick check if port is open before creating client
            sock = socket.create_connection((host, 9200), timeout=1)
            sock.close()
            self.client = OpenSearch(
                hosts=[{'host': host, 'port': 9200}],
                http_compress=True,
                http_auth=(settings.OPENSEARCH_USERNAME, settings.OPENSEARCH_PASSWORD),
                use_ssl=True,
                verify_certs=False,
                ssl_assert_hostname=False,
                ssl_show_warn=False,
            )
        except Exception as e:
            logger.warning(f"OpenSearch indisponible: {e}")
            self.client = None

    async def get_risk_score(self, ip_address: str) -> int:
        if not ip_address or not self.client:
            return 0
        try:
            query = {
                "size": 100,
                "query": {
                    "bool": {
                        "must": [
                            {"match": {"data.srcip": ip_address}},
                            {"range": {"timestamp": {"gte": "now-24h"}}}
                        ]
                    }
                }
            }
            response = self.client.search(body=query, index="wazuh-alerts-*", request_timeout=3)
            alerts = response['hits']['hits']
            if not alerts:
                return 0
            score = 0
            for hit in alerts:
                level = hit['_source']['rule']['level']
                if level >= 12: score += 50
                elif level >= 7: score += 20
                elif level >= 3: score += 5
            return min(score, 100)
        except Exception as e:
            logger.warning(f"Erreur risque OpenSearch: {e}")
            return 0

    async def get_compliance_data(self, ip_address: str) -> tuple:
        if not ip_address or not self.client:
            return 100, "compliant"
        try:
            query = {
                "size": 1,
                "query": {
                    "bool": {
                        "must": [
                            {"match": {"data.srcip": ip_address}},
                            {"match": {"rule.groups": "iot"}}
                        ]
                    }
                },
                "sort": [{"timestamp": {"order": "desc"}}]
            }
            response = self.client.search(body=query, index="wazuh-alerts-*", request_timeout=3)
            hits = response['hits']['hits']
            if not hits:
                return 100, "compliant"
            last_alert_level = hits[0]['_source']['rule']['level']
            if last_alert_level >= 14: return 20, "non-compliant"
            elif last_alert_level >= 10: return 60, "warning"
            return 95, "compliant"
        except Exception as e:
            logger.warning(f"Erreur conformité OpenSearch: {e}")
            return 100, "compliant"
