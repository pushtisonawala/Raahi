package db
import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)
var Pool *pgxpool.Pool
func Connect(databaseUrl string){
	pool,err:=pgxpool.New(context.Background(),databaseUrl);
	if(err!=nil){
		log.Fatalf("unable to connect to db",err);

	}
		if err := pool.Ping(context.Background()); err != nil {
		log.Fatalf("database ping failed: %v", err)
	}
	Pool=pool;
	log.Println("database connected successfully");


}
