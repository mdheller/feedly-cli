#!/usr/bin/env node
'use strict';

const 
    axios       = require('axios'),
    Cheerio     = require('cheerio'),
    Configstore = require('configstore'),
    { Input, MultiSelect } = require('enquirer'),
    mem         = require('mem'),
    parseMeta   = require('html-metadata').parseOpenGraph,
    pkg         = require('./package.json'),
    program     = require('commander'),
    validUrl    = require('valid-url')
;

const CONFIG_KEY_ACCESS_TOKEN = 'access_token';

let urlValue;

program
    .version(pkg.version)
    .arguments('<url>')
    .action(url => {
       urlValue = url;
    })
    .parse(process.argv);

if (program.args.length === 0) program.help();

if (!validUrl.isUri(urlValue)) {
    console.error('<url> is invalid');
    process.exit(1);
}

const config = new Configstore(pkg.name);

const saveAccessToken = access_token => config.set(CONFIG_KEY_ACCESS_TOKEN, access_token);

const askForAccessToken = () => {
    return (new Input({
       name: 'access_token',
       message: 'What is your access token?'
    })).run();
};

const getAccessToken = () => {
    return new Promise((resolve, reject) => {
        if (!config.has(CONFIG_KEY_ACCESS_TOKEN)) {
             return askForAccessToken().then(access_token => {
                 saveAccessToken(access_token);
                 return resolve(access_token);
             });
        } else {
            resolve(config.get(CONFIG_KEY_ACCESS_TOKEN));
        }
    });
};

const initFeedly = mem(() => {
    return getAccessToken()
        .then(access_token => {
            return axios.create({
                baseURL: 'https://cloud.feedly.com/v3',
                headers: {'Authorization': access_token} 
            });
        });
});

const getPageMetadata = mem(url => {
    return axios.get(url)
        .then(({ data }) => Cheerio.load(data))
        .then(cheerio => parseMeta(cheerio))
    ;
});

const listTags = mem(() => {
    return initFeedly()
        .then(feedly => feedly.get('/tags'))
        .then(({ data }) => data)
    ;
});

const getTagIdentifier = (tagLabels) => {
    return listTags().then(tags => {
        return tags.reduce((acc, tag) => {
            if (tagLabels.find(label => label === tag.label)) {
                acc.push(tag.id);
            }
            return acc;
        }, []);
    });
};

const choiceTags = () => {
    return listTags().then(tags => {
        const question = new MultiSelect({
            name: "tags",
            message: "Which tags do you want to give this url?",
            choices: () => {
                let test = tags.map(({label}) => label);
                return test.filter(label => label);
            }
        });
        return question.run().then(choices => {
            return getTagIdentifier(choices);
        });
    });
};

const toFeedlyTagObject = tagId => {
    return {id: tagId};
};

const postToFeedly = (url, tags, title, description) => {
    return initFeedly().then(feedly => {
        return feedly.post('/entries', {
            tags: tags.map(toFeedlyTagObject), 
            alternate: [
                {
                    href: url,
                    type: 'text/html'
                }
            ],
            origin: {
                "title": title,
                "htmlUrl": url
            },
            title: title,
            description: description
        });
    });
};

const saveUrl = (url) => {
    return Promise.all([getPageMetadata(url), choiceTags()])
        .then(results => {
            const metadata = results[0];
            const tags = results[1];
            return postToFeedly(url, tags, metadata.title, metadata.description);
        });
};

saveUrl(urlValue)
    .then(() => console.log('Klaar!'))
    .catch(error => console.log(error))
;

