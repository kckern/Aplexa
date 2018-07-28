DIR="/Users/kckern/Dropbox/Backups/Code/Aplexa"
cd $DIR
/usr/local/bin/tree ~/.ssh
/bin/pwd
/usr/bin/git add .
/usr/bin/git commit  -m 'Build $1: ${2}console' 
/usr/bin/git  push
/usr/local/bin/ask deploy