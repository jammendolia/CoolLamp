"""Bridge display snapshot follows the accepted possession transcript only."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
snapshot_source = (ROOT / 'tests/commission-runtime.cpp').read_text().split('int main(', 1)[0].replace(
    r'(tamperBrokerReveal&&!memcmp(frame.bytes.data(),"CCB\1",4))',
    r'(tamperBrokerReveal&&!memcmp(frame.bytes.data(),"CCB",3))') + r'''
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];
 side=1;Target::begin();LampCommissionComparisonSnapshot snapshot;snapshot.version=99;snapshot.symbols[0]=99;
 assert(!Target::comparisonSnapshot(snapshot)&&snapshot.version==0&&snapshot.count==0&&snapshot.symbols[0]==0&&!snapshot.approvalReady);
 const uint8_t version=scenario=="snapshot-v1"?1:2;
 if(scenario=="snapshot-hidden")tamperBrokerReveal=true;
 setup(scenario!="snapshot-hidden",version);side=1;
 if(scenario=="snapshot-hidden"){
  assert(!Target::comparisonSnapshot(snapshot)&&snapshot.version==0&&snapshot.count==0&&!snapshot.approvalReady);
  tamperBrokerReveal=false;run(1500);side=1;
 }
 assert(Target::comparisonSnapshot(snapshot)&&snapshot.version==version&&snapshot.count==(version==2?7:4));
 assert(!memcmp(snapshot.symbols,version==2?Broker::session.comparison:Broker::session.pattern,version==2?6:4));
 for(unsigned i=0;i<snapshot.count;++i)assert(snapshot.symbols[i]<16);
 if(version==2){assert(snapshot.symbols[6]==LampCommissionCue::check(Broker::session.comparison));assert(!snapshot.approvalReady);}
 else assert(snapshot.approvalReady);
 const auto accepted=snapshot;
 // A malformed advertisement/offer cannot alter an active target's display.
 for(const auto& frame:captured)if(frame.bytes.size()>=4&&!memcmp(frame.bytes.data(),"CCO",3)){
  LampEspNow::Received message;message.length=uint16_t(frame.bytes.size());message.receivedAt=now;memcpy(message.source,addresses[0],6);memcpy(message.data,frame.bytes.data(),frame.bytes.size());message.data[3]=version==2?1:2;side=1;assert(Target::receive(message));break;
 }
 side=1;assert(Target::comparisonSnapshot(snapshot)&&snapshot.version==accepted.version&&snapshot.count==accepted.count&&snapshot.approvalReady==accepted.approvalReady&&!memcmp(snapshot.symbols,accepted.symbols,7));
 if(version==2){run(LampCommissionCue::Cycle);side=1;assert(Target::comparisonSnapshot(snapshot)&&snapshot.approvalReady);}
 assert(!writes&&!paired[1]);approve();side=1;assert(!Target::comparisonSnapshot(snapshot)&&snapshot.version==0&&snapshot.count==0&&!snapshot.approvalReady);
 std::cout<<"PASS bridge "<<scenario<<": accepted symbols only, hidden before reveal, full-cycle approval, no raw offer changes\n";
}
'''
# Reuse the existing actual-P256 runner unchanged except for this fixture and
# its three scenarios. Its pinned-source checker verifies every crypto source.
runner = (ROOT / 'tests/commission-runtime.py').read_text()
tree = ast.parse(runner)
scenarios = next(node for node in tree.body if isinstance(node, ast.With)).body
assignment = next(node for node in scenarios if isinstance(node, ast.Assign) and
                  any(isinstance(target, ast.Name) and target.id == 'scenarios' for target in node.targets))
lines = runner.splitlines(keepends=True)
lines[assignment.lineno - 1:assignment.end_lineno] = [
    "    scenarios=['snapshot-v1','snapshot-v2','snapshot-hidden']\n"]
runner = ''.join(lines).replace("    (folder/'esp_mac.h').write_text(",
    "    (folder/'bridge-snapshot.cpp').write_text(snapshot_source)\n    (folder/'esp_mac.h').write_text(", 1)
runner = runner.replace("str(ROOT/'tests/commission-runtime.cpp')", "str(folder/'bridge-snapshot.cpp')")
exec(compile(runner, str(ROOT / 'tests/commission-runtime.py'), 'exec'),
     dict(__file__=str(__file__), __name__='__main__', snapshot_source=snapshot_source))
