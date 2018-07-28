PATH="/Users/kckern/Dropbox/Backups/Code/Aplexa"
cd $PATH
/bin/pwd
/usr/bin/git add .
/usr/bin/git commit --quiet -m 'Build $1: ${2}console'
/usr/bin/git --quiet push
/usr/local/bin/ask deploy