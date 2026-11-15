const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const vscode = require('vscode')

exports.run = async ({ api, repo, first, second }) => {
  const directory = process.env.PR_LENS_TEST_DIRECTORY
  const bin = path.join(directory, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.env.PR_LENS_TEST_NODE}
const fs = require('node:fs');
const path = require('node:path');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', value => prompt += value);
process.stdin.on('end', () => {
  fs.writeFileSync(path.join(process.env.PR_LENS_TEST_DIRECTORY, 'prompt.txt'), prompt);
  fs.writeFileSync(path.join(process.env.PR_LENS_TEST_DIRECTORY, 'cli-args.json'), JSON.stringify(process.argv.slice(2)));
  if (prompt.includes('wait-for-cancel')) { setInterval(() => {}, 1000); return; }
  if (prompt.includes('simulate-login-error')) {
    console.log(JSON.stringify({type:'result',subtype:'error',is_error:true,result:'OAuth session expired, please login'})); return;
  }
  const answer = prompt.includes('follow-up-example') ? 'Follow-up fixture answer' : '## Summary\\nFixture review. See \\x60file name #1.txt:1\\x60.';
  console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:answer}}}));
  setTimeout(() => console.log(JSON.stringify({type:'result',subtype:'success',result:answer,duration_ms:10})), 30);
});
`, { mode: 0o755 })
  const originalPath = process.env.PATH
  const originalBase = process.env.ANTHROPIC_BASE_URL
  const originalKey = process.env.ANTHROPIC_API_KEY
  const config = vscode.workspace.getConfiguration('prLens.ai')
  const checks = []
  let server
  const waitFor = async (condition) => {
    for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise((r) => setTimeout(r, 30)) }
    throw new Error('Timed out waiting for chat fixture')
  }
  try {
    process.env.PATH = bin + path.delimiter + originalPath
    await config.update('provider', 'claude-cli', vscode.ConfigurationTarget.Global)
    await vscode.commands.executeCommand('prLens.showCommit', first)
    await vscode.commands.executeCommand('prLens.reviewChanges')
    assert.equal(api.chat.error, '')
    assert.equal(api.chat.messages.length, 2)
    assert.match(api.chat.messages[1].text, /Fixture review/)
    const prompt = fs.readFileSync(path.join(directory, 'prompt.txt'), 'utf8')
    assert.ok(prompt.includes(first))
    assert.ok(!prompt.includes('second.txt'))
    const args = JSON.parse(fs.readFileSync(path.join(directory, 'cli-args.json'), 'utf8'))
    assert.ok(args.includes('--allowedTools') && args.includes('Read') && args.includes('--disallowedTools') && args.includes('Write'))
    const groups = vscode.window.tabGroups.all.length
    await api.chat.send('follow-up-example: which tests matter?')
    assert.equal(vscode.window.tabGroups.all.length, groups)
    assert.equal(api.chat.messages.length, 4)
    assert.equal(api.chat.messages[3].text, 'Follow-up fixture answer')
    const followup = fs.readFileSync(path.join(directory, 'prompt.txt'), 'utf8')
    assert.match(followup, /Fixture review/)
    assert.match(followup, /follow-up-example/)
    checks.push('PASS: CLI review streaming, selected-commit context, follow-up conversation')

    api.chat.clear()
    fs.rmSync(path.join(directory, 'prompt.txt'))
    const pending = api.chat.send('wait-for-cancel')
    await waitFor(() => fs.existsSync(path.join(directory, 'prompt.txt')))
    api.chat.stop()
    await pending
    assert.equal(api.chat.busy, false)
    await vscode.commands.executeCommand('prLens.showCommit', second)
    assert.equal(api.chat.messages.length, 0)
    await api.chat.send('simulate-login-error')
    assert.match(api.chat.error, /OAuth session expired/)
    api.chat.clear()
    assert.equal(api.chat.error, '')
    checks.push('PASS: cancellation, context reset, authentication errors, new chat')

    let request
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => body += chunk)
      req.on('end', () => {
        request = JSON.parse(body)
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const events = [
          {type:'message_start',message:{id:'fixture',type:'message',role:'assistant',model:'test-model',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},
          {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
          {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'API fixture answer'}},
          {type:'content_block_stop',index:0},
          {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}},
          {type:'message_stop'}
        ]
        for (const event of events) res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n')
        res.end()
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`
    process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-secret'
    await config.update('provider', 'anthropic-api', vscode.ConfigurationTarget.Global)
    await config.update('model', 'test-model', vscode.ConfigurationTarget.Global)
    await api.chat.send('Explain this commit')
    assert.equal(api.chat.error, '')
    assert.equal(api.chat.messages[1].text, 'API fixture answer')
    assert.match(request.messages[0].content, /Explain this commit/)
    assert.ok(request.messages[0].content.includes(second))
    checks.push('PASS: Anthropic API streaming against a local fixture, no paid API calls')
    return checks
  } finally {
    api.chat.stop()
    process.env.PATH = originalPath
    if (originalBase === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = originalBase
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
    server?.close()
    await config.update('provider', undefined, vscode.ConfigurationTarget.Global)
    await config.update('model', undefined, vscode.ConfigurationTarget.Global)
  }
}
