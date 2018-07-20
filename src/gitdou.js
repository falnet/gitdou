const _ = require('lodash');
const fs = require('fs');
const nodepath = require('path');
const eol = require('os').EOL;
const encode = 'utf8'

const gitdou = {
    init: () => {
        const gitdouStructure = {
            HEAD: 'ref: refs/heads/master\n',
            objects: {},
            refs: {
                heads: {}
            },
            config: JSON.stringify({core: {bare: false}}, null, 2)
        }
        files.writeFilesFromTree({'.gitdou': gitdouStructure}, process.cwd());
    },
    add: path => {
        const addedFiles = files.listAllMatchedFiles(path);
        // console.log(addedFiles);
        index.updateFilesIntoIndex(addedFiles);
    },
    commit: option => {
        // write current index into tree object
        const treeHash = gitdou.write_tree();
        // create commit object based on the tree hash
        const parentHash = "";
        const commitHash = objects.createCommit({treeHash, parentHash, option});
        // console.log(`commitHash ${commitHash}`);
        // point the HEAD to commit hash
        refs.updateRef({updateToRef: 'HEAD', hash: commitHash})
    },
    checkout: (commitHash) => {
        const diffs = diff.diff(refs.hash('HEAD'), commitHash);
        workingCopy.write(diffs);
    },
    write_tree: () => {
        const idx = index.read(false);
        const tree = files.nestFlatTree(idx);
        // console.log(`tree:${JSON.stringify(tree)}, hash:${objects.writeTree(tree)}`)
        return objects.writeTree(tree, true);
    }
};

module.exports = gitdou;


const files = {
    writeFilesFromTree: (tree, prefix) => {
        _.each(Object.keys(tree), name => {
            const path = nodepath.join(prefix, name);
            if (_.isString(tree[name])) {
                fs.writeFileSync(path, tree[name]);
            } else {
                if (!fs.existsSync(path)) {
                    fs.mkdirSync(path, 777);
                }
                files.writeFilesFromTree(tree[name], path);
            }
        });
    },
    listAllMatchedFiles: path => {
        if (path === files.getGitdouPath()) {
            return [];
        }
        if (!fs.existsSync(path)) {
            return [];
        }

        if (fs.statSync(path).isFile()) {
            return [path];
        }
        return fs.readdirSync(path).reduce((fileList, childDir) => {
            if (childDir === '.gitdou') {
                return fileList;
            }
            return fileList.concat(files.listAllMatchedFiles(nodepath.join(path, childDir)));
        }, []);
    },
    getGitdouPath: () => {
        return nodepath.join(process.cwd(), '.gitdou');
    },

    nestFlatTree: object => {
        return Object.keys(object).reduce((tree, key) => {
            return _.set(tree, _.replace(key, /\\/g, '.'), object[key]);
        }, {});
    },
    fileTree: (treeHash, tree) => {
        if (!tree) {
            return files.fileTree(treeHash, {});
        }
        const lines = util.lines(objects.read(treeHash));
        _.each(lines, line => {
            const [type, hash, path] = line.split(' ');
            if (type === 'blob') {
                tree[path] = hash;
            } else {
                tree[path] = {};
                files.fileTree(hash, tree[path]);
            }
        })
        return tree;
    },
    flattenTree: (tree, flattenObject, prefix) => {
        if (!flattenObject) {
            return files.flattenTree(tree, {}, '');
        }
        Object.keys(tree).forEach(key => {
            const path = nodepath.join(prefix, key);
            if (_.isString(tree[key])) {
                flattenObject[path] = tree[key];
            } else {
                return files.flattenTree(tree[key], flattenObject, path);
            }
        })
        return flattenObject;
    }
}

const index = {
    updateFilesIntoIndex: addedFiles => {
        // read existing index list from index file
        // calculate addedFiles hash
        // add new hash into index
        const allIndex = index.read();
        _.each(addedFiles, addedFile => {
            allIndex[`${addedFile},0`] = objects.write(fs.readFileSync(addedFile, "utf8"));
        });
        index.write(allIndex);
    },
    read: (withFileState = true) => {
        const indexPath = nodepath.join(files.getGitdouPath(), 'index');
        if (!fs.existsSync(indexPath)) {
            console.log('no index file found yet');
            return [];
        }
        const indexLines = fs.readFileSync(indexPath, 'utf8').split(eol).filter(line => !_.isEmpty(line));
        return indexLines.reduce((allIndex, line) => {
            const blobData = line.split(/ /);
            const key = withFileState ? `${blobData[0]},${blobData[1]}` : blobData[0];
            allIndex[key] = blobData[2];
            return allIndex;
        }, {});
    },
    write: allIndex => {
        const content = Object.keys(allIndex).map(key => key.split(',')[0] + ' ' + key.split(',')[1] + ' ' + allIndex[key])
            .join(eol) + eol;
        fs.writeFileSync(nodepath.join(files.getGitdouPath(), 'index'), content);
    },
}

const objects = {
    write: content => {
        // calculate hash
        const hash = util.hash(content);
        // save content into file
        const objectPath = nodepath.join(files.getGitdouPath(), 'objects', hash);
        fs.writeFileSync(objectPath, content);
        return hash;
        // return hash
    },
    writeTree: (tree, first = false) => {
        // first && console.log(`tree: ${JSON.stringify(tree)}`);
        const items = Object.keys(tree).map(key => {
            if (_.isString(tree[key])) {
                return `blob ${tree[key]} ${key}`;
            } else {
                return `tree ${objects.writeTree(tree[key])} ${key}`;
            }
        });
        const treeContent = items.join('\n') + '\n';

        // tree['fileb'] && console.log(`treeContent:${treeContent} | commitHash:${objects.write(treeContent)}`)
        return objects.write(treeContent);
    },
    createCommit: ({treeHash, parentHash, option}) => {
        const content = [];
        content.push(`commit ${treeHash}`);
        _.each(parentHash, hash => content.push(`parent ${hash}`));
        content.push(`Date:  ${new Date().toString()}`);
        content.push(`\n${option.m}`);
        return objects.write(content.join('\n'));
    },
    read: hash => {
        const objectPath = nodepath.join(files.getGitdouPath(), 'objects', hash);
        return fs.readFileSync(objectPath, 'utf8');
    },
    type: content => {
        const typeIndicator = _.split(content, ' ')[0];
        return {commit: 'commit', tree: 'tree', blob: 'blob'}[typeIndicator];
    },
    treeHash: content => {
        if (objects.type(content) === 'commit') {
            const firstLine = _.split(content, '\n')[0];
            return _.split(firstLine, ' ')[1];
        }
    },

    commitToContent: hash => {
        const detail = objects.read(hash);
        const treeHash = objects.treeHash(detail);
        // console.log(`treeHash: ${treeHash}`);
        const fileTree = files.fileTree(treeHash);
        // console.log(`fileTree : ${JSON.stringify(fileTree)}`);
        const flattenObject = files.flattenTree(fileTree);
        // console.log(`flattenObject:${JSON.stringify(flattenObject)}`);
        return flattenObject;
    }
}

const refs = {
    updateRef: ({updateToRef, hash}) => {
        const ref = refs.resolveRef(updateToRef);
        refs.write(ref, hash);
    },
    resolveRef: ref => {
        if (ref === 'HEAD') {
            const matched = fs.readFileSync(nodepath.join(files.getGitdouPath(), ref), 'utf8').match('ref: (refs/heads/.+)');
            return matched[1];
        }
    },
    write: (path, content) => {
        const target = nodepath.join(files.getGitdouPath(), path);
        fs.writeFileSync(target, content);
    },
    hash: ref => {
        const refFile = refs.resolveRef(ref);
        return fs.readFileSync(nodepath.join(files.getGitdouPath(), refFile), 'utf8');
    }
}
const util = {
    // hash : string => {
    //     let hashInt = 0;
    //
    //     for(let i=0; i< string.length; i++){
    //         (hashInt<<5) may cause hash conflict
    //         hashInt = (hashInt << 5) + string.charCodeAt(i);
    //         hashInt = hashInt | 0;
    //     }
    //     return Math.abs(hashInt).toString(16);
    // },
    hash: function (string) {
        var hashInt = 0;
        for (var i = 0; i < string.length; i++) {
            hashInt = hashInt * 31 + string.charCodeAt(i);
            hashInt = hashInt | 0;
        }

        return Math.abs(hashInt).toString(16);
    },
    lines: content => {
        return content.split('\n').filter(line => line !== '');
    }

}

const diff = {
    FILE_STATUS : {ADD:'A', MODIFY:'M',DELETE:'D',SAME:'SAME', CONFLICT:'CONFLICT'},
    diff: (receiverHash, giverHash) => {
        const receiver = objects.commitToContent(receiverHash);
        const giver = objects.commitToContent(giverHash);
        // console.log(`headTree:${JSON.stringify(receiver)}`);
        // console.log(`targetContent:${JSON.stringify(giver)}`);
        return diff.treeContentDiff(receiver, giver);
    },
    treeContentDiff: (receiver, giver) => {
        const paths = _.uniq(Object.keys(receiver).concat(Object.keys(giver)));
        return paths.reduce((diffs,path)=>{
            diffs[path] = {
                status:diff.fileStatus(receiver[path], giver[path]),
                receiver:receiver[path],
                path:path,
                giver: giver[path]
            };
            return diffs;
        },{})

    },
    fileStatus : (receiver, giver) => {
        if(receiver===giver){
            return diff.FILE_STATUS.SAME;
        }
        if(!receiver && giver){
            return diff.FILE_STATUS.ADD;
        }
        if(receiver && !giver){
            return diff.FILE_STATUS.DELETE
        }
        if(receiver && giver){
            return diff.FILE_STATUS.MODIFY;
        }
    }
}

const workingCopy = {
    write: diffs => {
        _.values(diffs).filter(item => item.status !== diff.FILE_STATUS.SAME).forEach(item => {
            const filePath = workingCopy.getPath(item.path);
            if (item.status === diff.FILE_STATUS.ADD || item.status === diff.FILE_STATUS.MODIFY) {
                fs.writeFileSync(filePath, objects.read(item.giver));
            }
            else if (item.status === diff.FILE_STATUS.DELETE) {
                fs.unlinkSync(filePath);
            }
        });
    },
    getPath : (path)=>{
        return nodepath.join(files.getGitdouPath(),'..',path);
    }
}