// The native host forwards length-prefixed Chrome messages over local IPC.
// It never logs message contents and has no runtime or network dependency.
package main
import("bufio";"encoding/binary";"encoding/json";"io";"os";"path/filepath")
type config struct { Endpoint string `json:"endpoint"`; Token string `json:"token"` }
func main(){
 exe,err:=os.Executable();if err!=nil{return};data,err:=os.ReadFile(filepath.Join(filepath.Dir(exe),"bridge.json"));if err!=nil{return}
 var cfg config;if json.Unmarshal(data,&cfg)!=nil{return};conn,err:=dial(cfg.Endpoint);if err!=nil{return};defer conn.Close()
 auth,_:=json.Marshal(map[string]string{"kind":"hello","token":cfg.Token});conn.Write(append(auth,'\n'))
 done:=make(chan struct{})
 go func(){defer close(done);scanner:=bufio.NewScanner(conn);scanner.Buffer(make([]byte,4096),1024*1024);for scanner.Scan(){b:=scanner.Bytes();var h [4]byte;binary.LittleEndian.PutUint32(h[:],uint32(len(b)));if _,err:=os.Stdout.Write(h[:]);err!=nil{return};if _,err:=os.Stdout.Write(b);err!=nil{return}};os.Stdin.Close()}()
 for{var h [4]byte;if _,err:=io.ReadFull(os.Stdin,h[:]);err!=nil{break};n:=binary.LittleEndian.Uint32(h[:]);if n==0||n>256*1024{break};b:=make([]byte,n);if _,err:=io.ReadFull(os.Stdin,b);err!=nil{break};if !json.Valid(b){break};if _,err:=conn.Write(append(b,'\n'));err!=nil{break}}
}
