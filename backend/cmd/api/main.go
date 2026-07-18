
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
)
func main(){
	r:=chi.NewRouter();
	r.Get("/health",func(w http.ResponseWriter,r *http.Request){
		w.Write([]byte(`{"status":"ok"}`))
	})
		port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))

}