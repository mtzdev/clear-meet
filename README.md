# ClearMeet

App para Windows que grava reuniões no seu computador (tela e áudio) e usa IA para gerar a transcrição, resumo e respostas para perguntas sobre a reunião. Você também pode fazer anotações durante a gravação, e cada uma fica ligada ao momento exato do vídeo.

## Recursos

- **Gravação local** da tela inteira ou de uma janela, com microfone e áudio do sistema.
- **Barra flutuante** durante a gravação, que não aparece no vídeo, e **anotações por atalho** global (padrão `Ctrl+Shift+Space`).
- **Transcrição** com separação de quem fala, em segundo plano. Dá para renomear os falantes.
- **Resumo** com pontos principais, decisões e responsáveis, e **perguntas** sobre a reunião, com links para os momentos citados.
- **Biblioteca** com busca no nome, nas falas, nas anotações e no resumo; clicar num resultado abre a reunião naquele momento.
- **Compactação** automática do vídeo em AV1 depois da reunião, para ocupar menos espaço, e **limpeza** em lote de reuniões antigas (os arquivos vão para a Lixeira).
- **Recuperação** de gravações interrompidas por queda de energia ou travamento.

## Instalação

1. Abra a página de [Releases](https://github.com/mtzdev/clear-meet/releases) e baixe a versão mais recente.
2. Execute o instalador. Ele instala só para o seu usuário, e cria atalhos no Menu Iniciar e na Área de Trabalho.

Requisitos: Windows 10 ou 11 (64 bits).

## Primeira execução

Na primeira vez que abre, o ClearMeet pede três coisas:

1. **Baixar o FFmpeg.** Ele é usado para finalizar os vídeos e compactá-los. O download (cerca de 100 MB) é feito uma única vez.
2. **Escolher a pasta das reuniões.** O padrão é `Documentos\ClearMeet`.
3. **Colar a chave de IA do Gemini** (obrigatória para transcrever). A chave da Groq é opcional.

Dá para mudar tudo isso depois em **Configurações**.

### Como obter a chave do Gemini

1. Entre em <https://aistudio.google.com/apikey> com a sua conta Google.
2. Clique em **Criar chave de API** (ou **Create API key**) e escolha um projeto.
3. Copie a chave e cole no ClearMeet. O botão de teste confirma se ela funciona.

### Como obter a chave da Groq (opcional)

Com a chave da Groq, o resumo e as perguntas usam a Groq, e o Gemini fica de reserva se ela falhar. Sem a chave da Groq, o ClearMeet usa o Gemini para essas tarefas.

1. Entre em <https://console.groq.com/keys> e crie uma conta ou faça login.
2. Clique em **Create API Key**, dê um nome e confirme.
3. Copie a chave (ela aparece só uma vez) e cole no ClearMeet.

As chaves ficam guardadas no seu computador, cifradas, e nunca são mostradas por inteiro.

## Onde ficam os arquivos

Cada reunião é uma pasta dentro da pasta das reuniões, e possui os seguintes arquivos:

| Arquivo | Conteúdo |
| --- | --- |
| `video.mp4` | O vídeo da reunião (compactado em AV1, se a compactação estiver ligada) |
| `audio.opus` | O áudio da reunião (microfone e sistema), usado pela IA |
| `meeting.json` | Nome, data, anotações e estado de cada etapa |
| `transcript.json`, `summary.json`, `chat.json` | Transcrição, resumo e conversa |

As configurações, chaves cifradas, miniaturas e o FFmpeg baixado ficam em `%APPDATA%\ClearMeet`.

## Privacidade

- A gravação, o vídeo e todos os arquivos ficam no seu computador.
- Só o **áudio** (para a transcrição) e o **texto** da transcrição (para resumo e perguntas) são enviados, e apenas aos serviços de IA para os quais você colocou uma chave: Google (Gemini) e, se quiser, Groq.
- O ClearMeet não tem conta, servidor próprio nem telemetria. As verificações de atualização consultam apenas o GitHub.

## Licença

[MIT](LICENSE).
