"""Exercise the actual migration and conditional mutation SQL with SQLite."""
import unittest,sqlite3,re,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'_server_islands/operations/src/main.rs').read_text()
APPEND=re.search(r'let sql\s*=\s*"(INSERT INTO fc_events[^";]+)"',SOURCE).group(1)
class DatabaseTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.db.executescript((ROOT/'schema.sql').read_text())
 def append(self,workspace='a',expected=0,op='operation-1',payload='{"revision":1}'):
  return len(self.db.execute(APPEND,[workspace,'entity-1',expected+1,op,'actor-1',payload,'hash',workspace,'entity-1',expected,workspace,op]).fetchall())
 def test_retry_is_idempotent(self):
  self.assertEqual(self.append(),1);self.assertEqual(self.append(),0)
  self.assertEqual(self.db.execute('select count(*) from fc_events').fetchone()[0],1)
 def test_concurrent_revision_is_rejected(self):
  self.assertEqual(self.append(),1);self.assertEqual(self.append(op='operation-2'),0)
  self.assertEqual(self.append(expected=1,op='operation-3',payload='{"revision":2}'),1)
 def test_workspace_isolation(self):
  self.append();self.assertEqual(self.append(workspace='b'),1)
  self.assertEqual(self.db.execute('select count(*) from fc_events where workspace=?',['b']).fetchone()[0],1)
 def test_atomic_provider_quota(self):
  source=(ROOT/'_server_islands/operations/src/providers.rs').read_text()
  sql=re.search(r'let sql\s*=\s*"(INSERT INTO fc_quota[^";]+)"',source).group(1)
  def consume(second=100,cost=1):return self.db.execute(sql,['a','geo:today',cost,second//60,second,10]).fetchall()
  for _ in range(4):self.assertTrue(consume())
  self.assertFalse(consume());self.assertTrue(consume(second=101,cost=6))
  self.assertFalse(consume(second=102))
  self.assertEqual(self.db.execute('select used from fc_quota').fetchone()[0],10)
if __name__=='__main__':unittest.main()
